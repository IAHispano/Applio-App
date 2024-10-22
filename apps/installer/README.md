# Applio App Installer

This is a simple installer for the Applio App. 

## Supported Systems
| System      | Support Status                          |
|-------------|-----------------------------------------|
| Windows 11  | Full support                            |
| Windows 10  | Full support                            |
| macOS       | No support, working to make it possible |
| Linux       | No support, working to make it possible |

### Prerequisites
- Install [Python](https://www.python.org/downloads/) (required for the server)

## Installation for developers

1. Clone the repository.
```bash
git clone https://github.com/blaisewf/applio-app-monorepo.git
```

2. Navigate to the `apps/installer` directory.

3. Set up the virtual environment.
```bash
py -m venv env
```

4.  Activate the virtual environment.
```bash
call .\env\Scripts\activate
```

5. Install the required packages.
```bash
pip install -r requirements.txt
```

6. Run the installer.
```bash
python install.py
```

### **Build installer**
    ```bash
    pyinstaller --onefile --icon=logo.ico --windowed --name=Applio-Installer --add-data "logo.ico;." --add-data ".env;." install.py
    ```

## Contributing

We welcome contributions to enhance the app’s features and support for additional systems. Please follow the installation steps above and submit a pull request to our repository.

## License

This project is licensed under the [CC BY-NC license](https://github.com/iahispano/applio-app/blob/master/LICENSE).

Feel free to contribute or suggest features!