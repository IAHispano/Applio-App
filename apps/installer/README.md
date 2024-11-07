## Applio App Installer 

This is the installer for the Applio App.

### Usage

Run environment setup script:

```bash
./env/scripts/activate
```

then build the installer, run the following command:

```bash
pyinstaller --onefile --icon=logo.ico --noconsole install.py --add-data "logo.ico;." --add-data ".env;."
```

This will create an installer.exe file in the dist directory.