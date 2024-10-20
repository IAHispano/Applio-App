[![APP Screenshot](https://i.imgur.com/RSFLuaL.png)](https://applio.org/products/app)

<p align="center">
  The easiest voice cloning tool, now in app. Made to be simple, fast, and light.
</p>

## Project Overview

This TurboRepo setup includes two main apps:
1. **Desktop App** (Tauri-based) – A lightweight voice cloning tool with a sleek, intuitive UI.
2. **Server** (Python-based) – Powers the backend, handles AI models, and provides essential APIs for the desktop app.

## Features
- [x] Simple integrated installation
- [x] Applio models support
- [x] RVC Auto-Update
- [x] Discord Presence integration
- [x] Conversion capabilities
- [ ] App Auto-Update (coming soon)
- [ ] Model Training (coming soon)
- [ ] Translations (coming soon)

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
   git clone https://github.com/bygimenez/applio-app.git
   ```

2. **Install the dependencies for the desktop app**:
   ```bash
   pnpm install --filter=desktop
   ```

3. **Navigate to the server folder**:
   ```bash
   cd apps/server
   ```

4. **Set up the virtual environment**:
   ```bash
   py -m venv env
   ```

5. **Activate the virtual environment**:
   - On Windows:
     ```bash
     .\env\Scripts\activate
     ```
   - On macOS/Linux:
     ```bash
     source env/bin/activate
     ```

6. **Install the server dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

7. **Build the server**:
   - On Windows:
     ```bash
     pyinstaller --onefile --icon=logo.ico --noconsole server.py && copy dist\server.exe ..\desktop\src-tauri\python\server.exe
     ```
   - On macOS/Linux:
     ```bash
     pyinstaller --onefile --icon=logo.ico --noconsole server.py && cp dist/server ../desktop/src-tauri/python/server.exe
     ```

8. **Return to the root folder of the project**:
   ```bash
   cd ../..
   ```

9. **Create a `.env` file**:
   Add your Supabase keys for proper API integration:
   ```bash
   VITE_API_KEY=your_supabase_api_key
   VITE_API_URL=your_supabase_url
   ```
   If you're not using Supabase, you can input placeholder values.

10. **Run the desktop application**:
   ```bash
   pnpm tauri dev
   ```

### **Run only the server**
    ```bash
    pnpm tauri server:{your operating system (windows/macos)}
    ```

### ** Build Applio App**
    ```bash
    pnpm tauri build:{your operating system (windows/macos)}
    ```

## Contributing

We welcome contributions to enhance the app’s features and support for additional systems. Please follow the installation steps above and submit a pull request to our repository.

## License

This project is licensed under the [CC BY-NC license](https://github.com/bygimenez/applio-app/blob/master/LICENSE).

## Acknowledgements

- [rvc-cli](https://github.com/blaisewf/rvc-cli) by [blaisewf](https://github.com/blaisewf)
- [Tauri](https://github.com/tauri-apps/tauri) by [Tauri team](https://github.com/tauri-apps)

Feel free to contribute or suggest features!