const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const { OpenAI } = require('openai');
const { exec } = require('child_process');
const mime = require('mime-types');

const app = express();
// Increase limit for potential base64 uploads if needed, 
// though we currently only read from local disk
app.use(express.json({ limit: '100mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.argv[2] || 3000;

// API to browse folders using pterm filepicker
app.get('/api/browse', (req, res) => {
  exec('pterm filepicker --type=folder', (error, stdout, stderr) => {
    if (error) {
      console.error(`exec error: ${error}`);
      return res.status(500).json({ error: 'Failed to open filepicker: ' + error.message });
    }
    const folderPath = stdout.trim();
    if (folderPath) {
      res.json({ path: folderPath });
    } else {
      res.status(400).json({ error: 'No folder selected' });
    }
  });
});

// API to check connection to LLM Studio
app.post('/api/check-connection', async (req, res) => {
  const { lmStudioUrl } = req.body;
  const baseUrl = lmStudioUrl || 'http://localhost:1234/v1';
  console.log(`Checking connection to: ${baseUrl}`);
  
  const openai = new OpenAI({
    apiKey: 'not-needed',
    baseURL: baseUrl,
    timeout: 5000,
  });

  try {
    // Try to list models as a connection check
    const models = await openai.models.list();
    console.log(`Connection successful via models.list(). Models found: ${models.data ? models.data.length : 'unknown'}`);
    res.json({ connected: true, models: models.data || [] });
  } catch (err) {
    console.warn(`openai.models.list() failed for ${baseUrl}: ${err.message}. Trying direct probe...`);
    
    // Fallback: try a direct fetch to the base URL or a common endpoint
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(baseUrl, { signal: controller.signal });
      clearTimeout(timeoutId);
      
      console.log(`Direct probe to ${baseUrl} returned status: ${response.status}`);
      // If we got any response from the server, consider it "on" even if it's 404/401
      res.json({ connected: true, warning: 'Server responded but models.list() failed' });
    } catch (fetchErr) {
      console.error(`All connection attempts failed for ${baseUrl}:`, fetchErr.message);
      res.json({ connected: false, error: fetchErr.message });
    }
  }
});

// Optimized API to get images and existing captions
app.get('/api/images', async (req, res) => {
  let { folderPath, page = 1, limit = 20 } = req.query;
  if (!folderPath) {
    return res.status(400).json({ error: 'Folder path is required' });
  }

  folderPath = folderPath.replace(/^"|"$/g, '');
  page = Math.max(1, parseInt(page));
  limit = Math.max(1, parseInt(limit));

  if (!fs.existsSync(folderPath)) {
    return res.status(400).json({ error: `Folder does not exist: ${folderPath}` });
  }

  try {
    const stats = await fs.stat(folderPath);
    if (!stats.isDirectory()) {
      return res.status(400).json({ error: 'Path is not a directory' });
    }

    const allFiles = await fs.readdir(folderPath);
    
    // Filter image files efficiently
    const imageFiles = allFiles.filter(file => {
      const ext = path.extname(file).toLowerCase();
      return ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].includes(ext);
    });

    const total = imageFiles.length;
    const totalPages = Math.ceil(total / limit);
    const startIndex = (page - 1) * limit;
    const pageFiles = imageFiles.slice(startIndex, startIndex + limit);

    const results = await Promise.all(pageFiles.map(async (file) => {
      const imagePath = path.join(folderPath, file);
      const txtPath = path.join(folderPath, path.parse(file).name + '.txt');
      
      let caption = '';
      try {
        if (await fs.pathExists(txtPath)) {
          caption = await fs.readFile(txtPath, 'utf8');
        }
      } catch (e) {
        console.warn(`Could not read caption for ${file}`);
      }
      
      let base64 = '';
      try {
        const buffer = await fs.readFile(imagePath);
        const m = mime.lookup(imagePath) || 'image/jpeg';
        base64 = `data:${m};base64,${buffer.toString('base64')}`;
      } catch (e) {
        console.error(`Could not read image ${file}`);
      }

      return {
        file,
        caption,
        image: base64,
        hasCaption: caption.length > 0
      };
    }));

    res.json({
      images: results,
      total,
      page,
      totalPages,
      limit
    });
  } catch (err) {
    console.error('Error in /api/images:', err);
    res.status(500).json({ error: err.message });
  }
});

// Basic path traversal protection
const isSafePath = (base, target) => {
  const resolvedBase = path.resolve(base);
  const resolvedTarget = path.resolve(target);
  return resolvedTarget.startsWith(resolvedBase);
};

// API to caption a single image
app.post('/api/caption-single', async (req, res) => {
  let { folderPath, fileName, prompt, lmStudioUrl, model, triggerTag } = req.body;

  if (!folderPath || !fileName) {
    return res.status(400).json({ error: 'Folder path and file name are required' });
  }
  folderPath = folderPath.replace(/^"|"$/g, '');

  const imagePath = path.join(folderPath, fileName);
  const textFilePath = path.join(folderPath, path.parse(fileName).name + '.txt');

  if (!isSafePath(folderPath, imagePath)) {
    return res.status(400).json({ error: 'Invalid file name' });
  }

  if (!fs.existsSync(imagePath)) {
    return res.status(400).json({ error: 'Image file does not exist' });
  }

  const baseUrl = lmStudioUrl || 'http://localhost:1234/v1';
  const openai = new OpenAI({
    apiKey: 'not-needed',
    baseURL: baseUrl,
  });

  try {
    const imageBuffer = await fs.readFile(imagePath);
    const mimeType = mime.lookup(imagePath) || 'image/jpeg';
    const imageData = `data:${mimeType};base64,${imageBuffer.toString('base64')}`;

    const response = await openai.chat.completions.create({
      model: model || 'model-identifier',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt || 'Caption this image' },
            {
              type: 'image_url',
              image_url: { url: imageData },
            },
          ],
        },
      ],
    });

    let caption = response.choices[0].message.content.replace(/<think>.*?<\/think>/gs, '').trim();
    
    if (triggerTag && triggerTag.trim()) {
      caption = `${triggerTag.trim()}, ${caption}`;
    }

    await fs.writeFile(textFilePath, caption);

    res.json({
      status: 'success',
      file: fileName,
      caption,
      image: imageData
    });
  } catch (err) {
    console.error('Error in /api/caption-single:', err);
    res.status(500).json({ error: err.message });
  }
});

// API to process captions
app.post('/api/caption', async (req, res) => {
  let { folderPath, prompt, lmStudioUrl, model, mode, triggerTag } = req.body;

  if (!folderPath) {
    return res.status(400).json({ error: 'Folder path is required' });
  }
  folderPath = folderPath.replace(/^"|"$/g, '');

  if (!fs.existsSync(folderPath)) {
    return res.status(400).json({ error: 'Invalid folder path' });
  }

  const baseUrl = lmStudioUrl || 'http://localhost:1234/v1';
  const openai = new OpenAI({
    apiKey: 'not-needed',
    baseURL: baseUrl,
  });

  // Pre-check connection
  try {
    await openai.models.list();
  } catch (err) {
    return res.status(500).json({ error: 'LLM instance not connected: ' + err.message });
  }

  try {
    const files = await fs.readdir(folderPath);
    const imageFiles = files.filter(file => {
      const ext = path.extname(file).toLowerCase();
      return ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].includes(ext);
    });

    if (imageFiles.length === 0) {
      return res.status(400).json({ error: 'No images found' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const total = imageFiles.length;
    let current = 0;
    let isAborted = false;

    req.on('close', () => {
      isAborted = true;
    });

    for (const imageFile of imageFiles) {
      if (isAborted) break;
      current++;
      const imagePath = path.join(folderPath, imageFile);
      const textFilePath = path.join(folderPath, path.parse(imageFile).name + '.txt');
      const exists = await fs.pathExists(textFilePath);

      if (mode === 'missing' && exists) {
        try {
          const existingCaption = await fs.readFile(textFilePath, 'utf8');
          const imageBuffer = await fs.readFile(imagePath);
          const m = mime.lookup(imagePath) || 'image/jpeg';
          res.write(`data: ${JSON.stringify({ 
            status: 'success', 
            current, 
            total, 
            file: imageFile, 
            caption: existingCaption,
            image: `data:${m};base64,${imageBuffer.toString('base64')}`,
            skipped: true
          })}\n\n`);
        } catch (e) {
          console.warn(`Error reading existing file ${imageFile}`);
        }
        continue;
      }

      try {
        const imageBuffer = await fs.readFile(imagePath);
        const base64Image = imageBuffer.toString('base64');
        const mimeType = mime.lookup(imagePath) || 'image/jpeg';
        const imageData = `data:${mimeType};base64,${base64Image}`;

        res.write(`data: ${JSON.stringify({ 
          status: 'started', 
          current, 
          total, 
          file: imageFile, 
          image: imageData
        })}\n\n`);

        const response = await openai.chat.completions.create({
          model: model || 'model-identifier',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt || 'Caption this image' },
                {
                  type: 'image_url',
                  image_url: { url: imageData },
                },
              ],
            },
          ],
        });

        const fullContent = response.choices[0].message.content;
        let caption = fullContent.replace(/<think>.*?<\/think>/gs, '').trim();
        
        if (triggerTag && triggerTag.trim()) {
          caption = `${triggerTag.trim()}, ${caption}`;
        }

        await fs.writeFile(textFilePath, caption);

        res.write(`data: ${JSON.stringify({ 
          status: 'success', 
          current, 
          total, 
          file: imageFile, 
          caption,
          image: imageData
        })}\n\n`);

      } catch (err) {
        res.write(`data: ${JSON.stringify({ 
          status: 'error', 
          file: imageFile, 
          error: err.message 
        })}\n\n`);
      }
    }

    if (!isAborted) {
      res.write(`data: ${JSON.stringify({ status: 'complete', total })}\n\n`);
    }
    res.end();

  } catch (err) {
    console.error('Error in /api/caption:', err);
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ status: 'error', error: err.message })}\n\n`);
      res.end();
    }
  }
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Server running at http://127.0.0.1:${PORT}`);
});
