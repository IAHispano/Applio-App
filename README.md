[![APP Screenshot](https://i.imgur.com/RSFLuaL.png)](https://applio.org/products/app)

<p align="center">
  The easiest voice cloning tool, now in app. Made to be simple, fast, and light.
</p>

## Features
- [x] Simple integrated installation
- [x] Applio models support
- [x] RVC Auto-Update
- [x] Discord Presence integration
- [x] Conversion capabilities
- [ ] Converted audios section
- [x] Installer
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
| macOS       | No support, working to make it possible |
| Linux       | No support, working to make it possible |

## Installation Instructions

### Prerequisites
- Install [pnpm](https://pnpm.js.org/)
- Install [Python](https://www.python.org/downloads/) (required for the server)
- Ensure you meet the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for desktop development

### Steps for Developers

1. **Clone the repository**:
   ```bash
   git clone https://github.com/iahispano/applio-app.git
   ```

2. **Run install.bat**:
   ```bash
   ./install.bat
   ```

   

### **Run Applio App**
    ```bash
    pnpm tauri dev
    ```
### **Run only the server**
    ```bash
    pnpm server:{your operating system (windows/macos)}
    ```
### **Build Applio App**
    ```bash
    pnpm build:{your operating system (windows/macos)}
    ```

## Contributing

We welcome contributions to enhance the app’s features and support for additional systems. Please follow the installation steps above and submit a pull request to our repository.

## License

This project is licensed under the [MIT license](https://github.com/iahispano/applio-app/blob/master/LICENSE).

## Acknowledgements

- [rvc-cli](https://github.com/blaisewf/rvc-cli) by [blaisewf](https://github.com/blaisewf)
- [Tauri](https://github.com/tauri-apps/tauri) by [Tauri team](https://github.com/tauri-apps)

Feel free to contribute or suggest features!
