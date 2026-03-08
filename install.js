module.exports = {
  run: [
    {
      method: "shell.run",
      params: {
        message: "npm install",
        path: "app"
      }
    },
    {
      method: "notify",
      params: {
        html: "Installation finished! Click 'Start' to begin captioning."
      }
    }
  ]
}
