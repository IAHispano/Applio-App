import os
import re
import zipfile
import shutil
import tkinter as tk
from tkinter import ttk, messagebox
from dotenv import load_dotenv
import requests
from tkinter import PhotoImage, font as tkFont
import threading
import sys

class InstallerApp:
    def __init__(self, master):
        # window
        self.master = master
        self.master.title("Applio Installer")
        self.master.geometry("800x400")
        self.master.iconbitmap(self.get_icon_path())
        self.master.configure(bg="#111111")
        self.master.resizable(False, False)

        self.main_frame = tk.Frame(master, bg="#111111")
        self.main_frame.pack(fill=tk.BOTH, expand=True, padx=(40), pady=20, anchor='w')

        # title
        self.label_font = tkFont.Font(family="Syne Mono", size=24, weight="bold")
        self.label = tk.Label(
            self.main_frame, 
            text="Install Applio App", 
            font=self.label_font, 
            fg="#FFFFFF", 
            bg="#111111",
            anchor='w',
            justify='left'
        )
        self.label.pack(pady=(10, 40), fill='x')

        # progress frame
        self.progress_frame = tk.Frame(self.main_frame, bg="#111111")
        self.progress_frame.pack(fill=tk.X, pady=20, anchor='w')

        # progress bar
        self.progress_var = tk.DoubleVar()
        self.progress = ttk.Progressbar(
            self.progress_frame,
            variable=self.progress_var,
            maximum=100,
            length=600,
            mode='determinate'
        )
        self.progress.pack(fill=tk.X, pady=10)

        # status label
        self.status_font = tkFont.Font(family="Syne Mono", size=10)
        self.status_label = tk.Label(
            self.progress_frame,
            text="Ready to install...",
            font=self.status_font,
            fg="#FFFFFF",
            bg="#111111",
            anchor='w',
            justify='left'
        )
        self.status_label.pack(pady=5, anchor='w')

        # buttons
        self.button_frame = tk.Frame(self.main_frame, bg="#111111")
        self.button_frame.pack(fill=tk.X, pady=20, side=tk.BOTTOM)

        # install button
        self.install_button_font = tkFont.Font(family="Syne Mono", size=10, weight="normal")
        self.install_button = tk.Button(
            self.button_frame,
            text="Install",
            command=self.start_installation,
            bg="#ffffff",
            fg="#111111",
            width=20,
            font=self.install_button_font
        )
        self.install_button.pack(side=tk.RIGHT)

        # cancel button
        self.cancel_button = tk.Button(
            self.button_frame,
            text="Cancel",
            command=self.master.quit,
            bg="#333333",
            fg="#FFFFFF",
            width=20,
            font=self.install_button_font
        )
        self.cancel_button.pack(side=tk.RIGHT, padx=10)

        self.download_path = os.getcwd()
        self.text_font = tkFont.Font(family="Syne Mono", size=8)
        self.path_label = tk.Label(master, text=f"We will install Applio in: {self.download_path}", fg="#FFFFFF", bg="#111111", font=self.text_font)
        self.path_label.place(relx=0.048, rely=0.18)

    def update_progress(self, value, status):
        self.progress_var.set(value)
        self.status_label.config(text=status)
        self.master.update()

    def start_installation(self):
        self.install_button.config(state=tk.DISABLED)
        self.cancel_button.config(state=tk.DISABLED)
        threading.Thread(target=self.install_model, daemon=True).start()

    def get_icon_path(self):
        if hasattr(sys, '_MEIPASS'):
            return os.path.join(sys._MEIPASS, "logo.ico")
        return "./logo.ico"

    def install_model(self):
        extDataDir = os.getcwd()
        if getattr(sys, 'frozen', False):
            extDataDir = sys._MEIPASS
        load_dotenv(dotenv_path=os.path.join(extDataDir, '.env'))
        token = os.getenv("HF_TOKEN")

        model_name = "bygimenez/applio-app"
        self.update_progress(0, "Starting installation...")

        headers = {"Authorization": f"Bearer {token}"}
        api_url = f"https://huggingface.co/api/models/{model_name}/tree/main"
        
        try:
            response = requests.get(api_url, headers=headers)
            if response.status_code != 200:
                raise Exception(f"Failed to fetch files: {response.status_code}")

            files = response.json()
            print("Available files in the model:")
            for file in files:
                print(file['path'])
            
            zip_files = [file['path'] for file in files if file['path'].endswith('.zip')]

            if not zip_files:
                messagebox.showerror("Error", "No .zip files found in the repository.")
                return

            version_pattern = re.compile(r'(\d+\.\d+\.\d+)')
            versions = {}

            for zip_file in zip_files:
                match = version_pattern.search(zip_file)
                if match:
                    version = match.group(1)
                    versions[zip_file] = version
                else:
                    print(f"No version match for: {zip_file}")

            if not versions:
                messagebox.showerror("Error", "No valid versions found in the .zip files.")
                return

            latest_zip_file = max(versions, key=versions.get)
            print(f"Latest file found: {latest_zip_file}")

            self.update_progress(25, "Downloading required files...")
            print(f"Downloading: {latest_zip_file}")

            download_url = f"https://huggingface.co/{model_name}/resolve/main/{latest_zip_file}"
            download_response = requests.get(download_url, headers=headers, stream=True)

            download_path = os.path.join(self.download_path, latest_zip_file)

            with open(download_path, 'wb') as f:
                shutil.copyfileobj(download_response.raw, f)

            print(f"Model downloaded to: {download_path}")

            self.update_progress(50, "Extracting required files...")
            extract_dir = os.getcwd()
            with zipfile.ZipFile(download_path, 'r') as zip_ref:
                zip_ref.extractall(extract_dir)
                print(f"File extracted to: {extract_dir}")

            self.update_progress(75, "Deleting temporary files...")
            os.remove(download_path)
            print(f"Downloaded zip file {latest_zip_file} deleted.")

            self.update_progress(100, "Applio installed successfully.")
            messagebox.showinfo("Success", "Applio installed successfully.")
            self.master.destroy()

        except Exception as e:
            messagebox.showerror("Error", f"Error during installation: {e}")


if __name__ == "__main__":
    root = tk.Tk()
    app = InstallerApp(root)
    root.mainloop()
