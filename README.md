[![APP Screenshot](https://i.imgur.com/RSFLuaL.png)](https://applio.org/products/app)

<p align="center">
  The easiest voice cloning tool, now in app. Made to be simple, fast, and light.
</p>

## Features
- [x] Simple integrated installation
- [x] Applio models support
- [x] Custom models support
- [x] My models section
- [x] RVC Auto-Update
- [x] Installer
- [x] Discord Presence integration
- [x] Conversion capabilities
- [x] Converted audios section
- [x] Window personalization
- [x] Authentication with applio.org
- [ ] App Auto-Update
- [ ] Model Training
- [ ] Translations
- [ ] macOS support
- [ ] Linux support

## Supported Systems
| System      | Support Status                          |
|-------------|-----------------------------------------|
| Windows 11  | Full support                            |
| Windows 10  | Full support                            |
| macOS       | No support                              |
| Linux       | No support                              |

## For developers

### Prerequisites
- Install [pnpm](https://pnpm.js.org/)
- Install [Python](https://www.python.org/downloads/) (required for the server)
- Ensure you meet the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for desktop development

### Steps

1. **Clone the repository**:
   ```bash
   git clone https://github.com/iahispano/applio-app.git
   ```

2. **Run install.bat**:
   ```bash
   ./install.bat
   ```
   

### **Run Applio App**
  ##### This will **open the app** in development mode.
    ```bash
    pnpm tauri dev
    ```
### **Build Applio App**
  ##### For build you need to copy .env file from root to apps/server folder.
  ##### This will **generate a `build` folder** with a `server.exe` file and `applio-app.exe`. Insert the `server` file inside a folder named `python` and run applio-app.exe.
    ```bash
    pnpm build
    ```
### **Run the server**
  ##### This will open **only the server** so you can make changes only in the backend.
    ```bash
    pnpm run server
    ```

## Roadmap
[![APP Roadmap](https://i.imgur.com/LMqCMBV.png)](https://applio.org/products/app)

## Screenshoots

### **Installer**
[![Installer Home Section](https://i.imgur.com/q0rJh6G.png)](https://applio.org/products/app)
[![Installer Path Section](https://i.imgur.com/HLSJ2Eu.png)](https://applio.org/products/app)
[![Installer Install Section](https://i.imgur.com/e1WKWi9.png)](https://applio.org/products/app)
[![Installer Success Section](https://i.imgur.com/Rfb6zHe.png)](https://applio.org/products/app)

### **App**
[![APP Home Section](https://i.imgur.com/DvjHl5r.png)](https://applio.org/products/app)
[![APP Inference Section](https://i.imgur.com/dOpurov.png)](https://applio.org/products/app)
[![APP Audios Section](https://i.imgur.com/8gDuE0z.png)](https://applio.org/products/app)
[![APP Models Section](https://i.imgur.com/dN68rWm.png)](https://applio.org/products/app)
[![APP Settings Section](https://i.imgur.com/H2KEaQu.png)](https://applio.org/products/app)

###### <p align="center">*Pre-release images. Final product may vary*</p>

## Contributing

We welcome contributions to enhance the app’s features and support for additional systems. Please follow the installation steps above and submit a pull request to our repository.

## License

This project is licensed under the [MIT license](https://github.com/iahispano/applio-app/blob/master/LICENSE).

## Acknowledgements

- [rvc-cli](https://github.com/blaisewf/rvc-cli) by [blaisewf](https://github.com/blaisewf)
- [Tauri](https://github.com/tauri-apps/tauri) by [Tauri team](https://github.com/tauri-apps)
