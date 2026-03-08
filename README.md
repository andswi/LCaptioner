# LCaptioner

LCaptioner is a powerful, local batch image captioning tool designed for the Pinokio ecosystem. It leverages local Large Language Models (LLMs) via OpenAI-compatible APIs (like LM Studio) to generate high-quality descriptions for image datasets, making it an essential tool for preparing training data for Stable Diffusion, Flux, or other vision-based models.

## 🚀 Features

- **Local LLM Integration**: Seamlessly connect to LM Studio, Ollama, or any OpenAI-compatible local API.
- **Smart Batch Processing**:
  - **Caption Missing**: Only process images that don't have an associated `.txt` file.
  - **Update All**: Refresh descriptions for every image in the folder.
- **Trigger Tag Injection**: Prepend custom trigger words (e.g., `ohwx`, `style of [name]`) to every caption automatically.
- **Real-Time Progress & ETR**: Track your progress with a visual progress bar, total time elapsed, and estimated time remaining.
- **Single Image Captioning**: Fine-tune your dataset by captioning or re-captioning individual images directly from the gallery.
- **Model Discovery**: Automatically fetches and lists available models from your connected LLM instance.
- **Abort Control**: Safely stop batch processes at any time without losing already saved captions.
- **Modern UI**: Clean, responsive interface with Dark and Light mode support.

## 📦 Installation

Since this is a Pinokio-ready application, installation is a one-click process:

1. Open your **Pinokio** browser.
2. Click on **Download** and paste the repository URL.
3. Once the repository is cloned, click **Install**. Pinokio will automatically set up the Node.js environment and dependencies.

## 🛠 Usage

1. **Launch**: Click **Start** in Pinokio to run the local server.
2. **Select Folder**: Use the **Select Folder** button to pick your dataset directory.
3. **Configure API**:
   - Ensure your local LLM server (e.g., LM Studio) is running and the **API URL** is correct.
   - The status indicator will turn **green** once a connection is established.
   - Select your desired vision-capable model from the **Model Identifier** dropdown.
4. **Set Prompt & Tags**: Enter your captioning prompt and an optional trigger tag.
5. **Caption**: Click **Caption Missing** or **Update All** to begin.

## 📝 API Integration

LCaptioner provides a simple internal API for interacting with the backend:

- `GET /api/images`: Retrieve paginated images and captions from a folder.
- `POST /api/caption`: Start a batch captioning stream (SSE).
- `POST /api/check-connection`: Verify LLM API availability and fetch models.
- `POST /api/caption-single`: Process a single image.

