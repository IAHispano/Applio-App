<h1 align="center">
  <a href="https://applio.org" target="_blank"><img src="https://github.com/user-attachments/assets/3967c099-221f-47bb-98d2-a23fe09f4113" alt="Applio"></a>
</h1>

<p align="center">
    <img alt="Contributors" src="https://img.shields.io/github/contributors/iahispano/applio-app?style=for-the-badge&color=00AA68" />
    <img alt="Release" src="https://img.shields.io/github/release/iahispano/applio-app?style=for-the-badge&color=00AA68" />
    <img alt="Stars" src="https://img.shields.io/github/stars/iahispano/applio-app?style=for-the-badge&color=00AA68" />
    <img alt="Fork" src="https://img.shields.io/github/forks/iahispano/applio-app?style=for-the-badge&color=00AA68" />
    <img alt="Issues" src="https://img.shields.io/github/issues/iahispano/applio-app?style=for-the-badge&color=00AA68" />
</p>

<p align="center">Lightweight interface for fast interaction with AI-driven voice cloning technology </p>

<p align="center">
  <a href="https://applio.org" target="_blank">🌐 Website</a>
  •
  <a href="https://docs.applio.org" target="_blank">📚 Documentation</a>
  •
  <a href="https://discord.gg/urxFjYmYYh" target="_blank">☎️ Discord</a>
</p>

## Supported Systems

| System        | Support Status |
| ------------- | -------------- |
| Windows 10-11 | Full support   |
| macOS         | Not supported  |
| Linux         | Not supported  |

## For Developers

### Prerequisites

- Install [pnpm](https://pnpm.js.org/) (Node.js package manager)
- Install [Python](https://www.python.org/downloads/) (required for the server)
- Ensure you meet the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for desktop development

### Setup Instructions

1. **Clone the repository**:

   ```bash
   git clone https://github.com/iahispano/applio-app.git
   ```

2. **Run the installation script**:
   ```bash
   ./install.bat
   ```

### Running the App

- To **run the app in development mode**, use:
  ```bash
  pnpm tauri dev
  ```

### Building the App

- To **build the app** and generate executable files, follow these steps:
  1. Copy the `.env` file from the root directory to the `apps/server` folder.
  2. Run the following command to build the app:
     ```bash
     pnpm build
     ```
  - This will generate a `build` folder containing the `server.exe` and `applio-app.exe` files.
  - Place the `server.exe` inside a folder named `python` and run `applio-app.exe`.

### Running the Server

- To **run only the server** (for backend modifications), use:
  ```bash
  pnpm run server
  ```

## Screenshots

Keep updated about the latest features and improvements at https://applio.org/products/app

### **Installer Screens**

<table align="center">
  <tr>
    <td><a href="https://applio.org/products/app"><img src="https://i.imgur.com/q0rJh6G.png" alt="Installer Home Section" /></a></td>
    <td><a href="https://applio.org/products/app"><img src="https://i.imgur.com/HLSJ2Eu.png" alt="Installer Path Section" /></a></td>
  </tr>
  <tr>
    <td><a href="https://applio.org/products/app"><img src="https://i.imgur.com/e1WKWi9.png" alt="Installer Install Section" /></a></td>
    <td><a href="https://applio.org/products/app"><img src="https://i.imgur.com/Rfb6zHe.png" alt="Installer Success Section" /></a></td>
  </tr>
</table>

### **App Screens**

<table align="center">
  <tr>
    <td><a href="https://applio.org/products/app"><img src="https://i.imgur.com/DvjHl5r.png" alt="App Home Section" /></a></td>
    <td><a href="https://applio.org/products/app"><img src="https://i.imgur.com/dOpurov.png" alt="App Inference Section" /></a></td>
  </tr>
  <tr>
    <td><a href="https://applio.org/products/app"><img src="https://i.imgur.com/8gDuE0z.png" alt="App Audios Section" /></a></td>
    <td><a href="https://applio.org/products/app"><img src="https://i.imgur.com/dN68rWm.png" alt="App Models Section" /></a></td>
  </tr>
  <tr>
    <td colspan="2"><a href="https://applio.org/products/app"><img src="https://i.imgur.com/H2KEaQu.png" alt="App Settings Section" /></a></td>
  </tr>
</table>

_Pre-release images. Final product may vary_

## License

This project is licensed under the [MIT License](./LICENSE).

## Acknowledgements

- [rvc-cli](https://github.com/blaisewf/rvc-cli) by [blaisewf](https://github.com/blaisewf)
- [Tauri](https://github.com/tauri-apps/tauri) by [Tauri team](https://github.com/tauri-apps)
