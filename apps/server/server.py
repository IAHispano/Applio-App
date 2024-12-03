import os
import io
import re
import sys
import json
import uuid
import ctypes
import socket
import shutil
import signal
import zipfile
import logging
import requests
import traceback
import subprocess
import threading

from datetime import datetime
from urllib.parse import unquote
from flask import Flask, jsonify, request, Response, send_file
from flask_cors import CORS
from requests.exceptions import HTTPError
from dotenv import load_dotenv

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})
load_dotenv()

def get_root_dir():
    return (
        os.path.abspath(os.path.dirname(sys.executable))
        if getattr(sys, 'frozen', False)
        else os.path.abspath(os.path.dirname(__file__))
    )

# Define log directory relative to the script's location
BASE_DIR = get_root_dir()
LOGS_DIR = os.path.join(BASE_DIR, "logs")
os.makedirs(LOGS_DIR, exist_ok=True)

LOG_FILE = os.path.join(LOGS_DIR, "server_log.log")
DEVICE_ID_FILE = os.path.join(LOGS_DIR, "device_id.json")
VERSION_FILE = os.path.join(BASE_DIR, "version.json")
MODELS_DIR = os.path.join(LOGS_DIR, "models")
RVC_DIR = os.path.join(BASE_DIR, "rvc")
RVC_LOGS_DIR = os.path.join(RVC_DIR, "logs")
INPUT_AUDIO_DIR = os.path.join(BASE_DIR, "audios", "input")
OUTPUT_AUDIO_DIR = os.path.join(BASE_DIR, "audios", "output")
INFERENCE_LOGS_DIR = os.path.join(LOGS_DIR, "inference")

# Create directories if they don't exist
os.makedirs(LOGS_DIR, exist_ok=True)
os.makedirs(MODELS_DIR, exist_ok=True)
os.makedirs(INPUT_AUDIO_DIR, exist_ok=True)
os.makedirs(OUTPUT_AUDIO_DIR, exist_ok=True)
os.makedirs(INFERENCE_LOGS_DIR, exist_ok=True)

# Configure logging
logging.basicConfig(
    filename=LOG_FILE,
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logging.getLogger("flask").setLevel(logging.ERROR)
logging.getLogger("werkzeug").setLevel(logging.ERROR)

WEBHOOK_URL = os.getenv("DISCORD_WEBHOOK_URL")


def read_json_file(file_path):
    """Reads JSON data from a file, returns the data or None on error."""
    if os.path.exists(file_path):
        try:
            with open(file_path, "r") as file:
                return json.load(file)
        except (json.JSONDecodeError, IOError) as e:
            logging.error(f"Error reading {file_path}: {e}")
    else:
        logging.error(f"File {file_path} does not exist.")
    return None


def write_json_file(file_path, data):
    """Writes data to a JSON file."""
    try:
        with open(file_path, "w") as file:
            json.dump(data, file, indent=4)
    except IOError as e:
        logging.error(f"Error writing to {file_path}: {e}")


def generate_device_id():
    """Generates a unique device ID based on MAC address."""
    return hex(uuid.getnode())


def get_device_id():
    """Gets or generates the device ID."""
    data = read_json_file(DEVICE_ID_FILE)
    if data:
        return data.get("device_id")
    else:
        device_id = generate_device_id()
        write_json_file(DEVICE_ID_FILE, {"device_id": device_id, "send_data": False})
        return device_id


def get_send_data():
    """Returns whether the device should send data."""
    data = read_json_file(DEVICE_ID_FILE)
    return bool(data.get("send_data", False)) if data else False


def set_send_data(value):
    """Sets whether the device should send data."""
    data = read_json_file(DEVICE_ID_FILE)
    if data:
        data["send_data"] = bool(value)
        write_json_file(DEVICE_ID_FILE, data)
        return {"success": True}
    else:
        return {"success": False, "error": "Device ID file not found"}


def send_logs(error_message):
    """Sends logs to a webhook if send_data is True."""
    device_id = get_device_id()
    current_time = datetime.utcnow().isoformat()

    def extract_exception(error_message):
        match = re.match(r"(Traceback.*?)(Exception:.*)", error_message, re.DOTALL)
        return (
            (match.group(1).strip(), match.group(2).strip())
            if match
            else (error_message, "")
        )

    def sanitize_paths(match):
        return os.path.basename(match.group(0))

    traceback_str, exception_message = extract_exception(error_message)
    exception_message = re.sub(r"^Exception:\s*", "", exception_message)
    privated_traceback = re.sub(r"[A-Za-z]:[\\/][^\s]+", sanitize_paths, traceback_str)

    if not get_send_data():
        logging.debug("send_data is False. Logs will not be sent.")
        return

    if WEBHOOK_URL:
        embed = {
            "embeds": [
                {
                    "title": "Server Error Occurred",
                    "color": 16711680,
                    "fields": [
                        {
                            "name": "Error Traceback",
                            "value": privated_traceback[:2000],
                            "inline": False,
                        },
                        {
                            "name": "Exception Message",
                            "value": exception_message[:2000],
                            "inline": False,
                        },
                        {"name": "Device ID", "value": device_id, "inline": True},
                    ],
                    "timestamp": current_time,
                }
            ]
        }

        try:
            response = requests.post(WEBHOOK_URL, json=embed)
            if response.status_code != 204:
                logging.error(f"Failed to send log to Discord: {response.text}")
        except requests.exceptions.RequestException as e:
            logging.error(f"Error sending logs: {str(e)}")
            handle_exception(e)
    else:
        logging.error("WEBHOOK_URL not set")


@app.errorhandler(Exception)
def handle_exception(e):
    """Handles exceptions and logs them."""
    error_message = traceback.format_exc()
    logging.error(error_message)
    send_logs(error_message)
    return {"error": "Unexpected error occurred."}, 500


@app.before_request
def log_request_info():
    """Logs request information."""
    logging.info(f"Request: {request.method} {request.url}")


def remove_ansi_escape_sequences(log_line):
    """Removes ANSI escape sequences from log lines."""
    ansi_escape = re.compile(r"(?:\x1B[@-_][0-?]*[ -/]*[@-~])")
    return ansi_escape.sub("", log_line)


# find available port (if not provided as argument)
def find_available_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


# get latest commit hash
def get_latest_commit_hash():
    api_url = "https://api.github.com/repos/blaisewf/rvc-cli/commits/main"

    try:
        response = requests.get(api_url)
        response.raise_for_status()

        if (
            response.status_code == 403
            and "X-RateLimit-Remaining" in response.headers
            and response.headers["X-RateLimit-Remaining"] == "0"
        ):
            return None

        commit_data = response.json()
        return {"commit_hash": commit_data["sha"]}

    except Exception as err:
        handle_exception(err)


# save last commit hash to version.json
def save_commit_info(commit_hash):
    if not commit_hash:
        logging.info("No commit hash to save due to an error or rate limit.")
        return

    logging.info(f"Saving commit {commit_hash} to {VERSION_FILE}")
    with open(VERSION_FILE, "w") as version_file:
        json.dump({"commit_hash": commit_hash}, version_file)
    logging.info(f"Saved commit {commit_hash} to version.json")


# load last commit hash from version.json
def load_commit_info():
    logging.info(f"Loading commit info from {VERSION_FILE}")
    if not os.path.exists(VERSION_FILE):
        logging.info("No commit info found.")
        return None
    with open(VERSION_FILE, "r") as version_file:
        data = json.load(version_file)
        return data.get("commit_hash")


def checkUpdate():
    try:
        latest_commit_hash = get_latest_commit_hash()
        logging.debug(f"Latest commit hash: {latest_commit_hash}")

        saved_commit_hash = load_commit_info()
        logging.debug(f"Saved commit hash: {saved_commit_hash}")

        if saved_commit_hash is None:
            logging.info("RVC repository needs to be downloaded.")
            yield "data: RVC repository needs to be downloaded.\n\n"
            return True 

        if saved_commit_hash == latest_commit_hash:
            logging.info("RVC repository is up to date. No need to download.")
            yield "data: RVC repository is up to date. No need to download.\n\n"
            return False 

        logging.info(f"Updating RVC repository: {saved_commit_hash} != {latest_commit_hash}")
        yield "data: RVC repository update required.\n\n"
        return True 

    except Exception as e:
        logging.error(f"Error checking for repository update: {e}")
        yield "data: Error checking repository update.\n\n"
        return False 



def is_admin():
    try:
        return ctypes.windll.shell32.IsUserAnAdmin()
    except:
        return False


def RVC_repository_exists():
    exists = os.path.isdir(RVC_DIR)
    logging.info(f"RVC repository exists at {RVC_DIR}: {exists}")
    return exists


# download RVC repository from GitHub and extract it
def downloadRepo():
    extraction_path = BASE_DIR
    new_folder_name = os.path.join(RVC_DIR)
    latest_commit_hash = get_latest_commit_hash()

    check_update = checkUpdate()
    if check_update == False:
        yield "data: RVC repository is up to date. No need to download.\n\n"
        return

    yield "data: Downloading RVC repository from GitHub...\n\n"

    url = "https://github.com/blaisewf/rvc-cli/archive/refs/heads/main.zip"
    logging.info(
        remove_ansi_escape_sequences("Downloading RVC repository from GitHub...")
    )

    try:
        response = requests.get(url, stream=True)
        response.raise_for_status()
        yield "data: Downloading RVC repository from GitHub... Done!\n\n"
        logging.info(
            remove_ansi_escape_sequences(
                "Downloading RVC repository from GitHub... Done!"
            )
        )

        os.makedirs(extraction_path, exist_ok=True)

        with zipfile.ZipFile(io.BytesIO(response.content)) as zip_file:
            zip_file.extractall(extraction_path)
            yield "data: Extracting RVC repository from GitHub... Done!\n\n"

        old_folder_name = os.path.join(extraction_path, "rvc-cli-main")

        if os.path.exists(new_folder_name):
            shutil.rmtree(new_folder_name)
            logging.info(
                remove_ansi_escape_sequences(
                    f"Removed existing folder: {new_folder_name}"
                )
            )

        if os.path.exists(old_folder_name):
            os.rename(old_folder_name, new_folder_name)
            yield 'data: Renaming extracted folder to "rvc"... Done!\n\n'
            logging.info(
                remove_ansi_escape_sequences(
                    f"Renamed folder from 'rvc-cli-main' to 'rvc'"
                )
            )

        yield "data: RVC repository downloaded successfully.\n\n"
        save_commit_info(latest_commit_hash)
        logging.info(f"Saved commit {latest_commit_hash} to version.json")
        yield from runInstallation()

    except requests.RequestException as e:
        logging.error(
            remove_ansi_escape_sequences(
                f"Error downloading RVC repository from GitHub: {str(e)}"
            )
        )
        yield "data: Error downloading RVC repository from GitHub.\n\n"
        handle_exception(e)
    except zipfile.BadZipFile as e:
        logging.error(remove_ansi_escape_sequences("Error: Bad ZIP file"))
        yield "data: Error: Bad ZIP file.\n\n"
        handle_exception(e)
    except OSError as e:
        logging.error(
            remove_ansi_escape_sequences(f"Error during extraction: {str(e)}")
        )
        yield "data: Error during extraction.\n\n"
        handle_exception(e)


def downloadPretraineds():
    command = [os.path.join("env", "python.exe"), "rvc_cli.py", "prerequisites"]

    logging.info(f"command: {command}")
    logging.info(f"path: {RVC_DIR}")
    yield "data: Starting installation...\n\n"

    try:
        process = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            shell=True,
            cwd=RVC_DIR,
        )

        for line in process.stdout:
            if line:
                yield f"data: {line}\n\n"
                logging.info(f"data: {line}\n\n")

        process.wait()

        if process.returncode == 0:
            yield "data: Pretraineds installed successfully.\n\n"
        else:
            yield f"data: Installation failed with return code {process.returncode}\n\n"

    except Exception as e:
        yield f"data: Error running installation: {str(e)}\n\n"
        handle_exception(e)


# run RVC installation
def runInstallation():
    bat_file_path = os.path.abspath(
        os.path.join(RVC_DIR, "install.bat")
    )

    yield "data: Starting installation...\n\n"
    logging.info(remove_ansi_escape_sequences("Starting installation..."))

    try:
        process = subprocess.Popen(
            [bat_file_path],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            shell=True,
            cwd=RVC_DIR
        )

        for line in process.stdout:
            yield f"data: {line}\n\n"
            logging.info(line.strip())

        process.stdout.close()
        process.kill()

        yield "data: Installation completed successfully.\n\n"
        logging.info(
            remove_ansi_escape_sequences("Installation completed successfully.")
        )

    except Exception as e:
        yield f"data: Error running installation: {str(e)}\n\n"
        logging.error(
            remove_ansi_escape_sequences(f"Error running installation: {str(e)}")
        )
        handle_exception(e)


# get latest downloaded model
def get_latest_files(directory):
    model_files = {"pth": None, "index": None}
    latest_times = {"pth": 0, "index": 0}

    for root, dirs, files in os.walk(directory):
        for file in files:
            file_path = os.path.join(root, file)
            file_mtime = os.path.getmtime(file_path)

            if file.endswith(".pth") and file_mtime > latest_times["pth"]:
                model_files["pth"] = file_path
                latest_times["pth"] = file_mtime

            elif file.endswith(".index") and file_mtime > latest_times["index"]:
                model_files["index"] = file_path
                latest_times["index"] = file_mtime

    logging.info(f"Model .pth file found: {model_files['pth']}")
    logging.info(f"Model .index file found: {model_files['index']}")

    if not model_files["pth"] or not model_files["index"]:
        return None

    return model_files


# download model
def downloadModel(
    modelLink, model_id, model_epochs, model_algorithm, model_name, author, server
):
    command = [
        os.path.join("env", "python.exe"),
        "rvc_cli.py",
        "download",
        "--model_link",
        f'"{unquote(modelLink)}"',
    ]

    logging.info(remove_ansi_escape_sequences(f"command: {' '.join(command)}"))
    logging.info(remove_ansi_escape_sequences(f"rvc dir: {RVC_DIR}"))

    yield "data: Downloading model...\n\n"
    logging.info(remove_ansi_escape_sequences("Downloading model..."))

    try:
        process = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            shell=True,
            cwd=RVC_DIR,
        )

        for line in process.stdout:
            yield f"data: {line}\n\n"
            logging.info(line.strip())

            if "error" in line.lower():
                yield "data: Error detected during download process. Stopping execution.\n\n"
                logging.error("Error detected in download process.")
                raise Exception(f"Error detected in download process: {line.lower()}")

        process.stdout.close()
        process.kill()

        if process.returncode != 0:
            error_message = process.stderr.read()
            logging.error(f"Error downloading model: {error_message}")
            yield "data: Error downloading model.\n\n"
            raise Exception(f"Error downloading model: {error_message}")

        logging.info(f"Logs directory: {RVC_LOGS_DIR}")

        model_files = get_latest_files(RVC_LOGS_DIR)

        if (
            not model_files
            or not model_files.get("pth")
            or not model_files.get("index")
        ):
            yield "data: Error: No .pth or .index file found in the logs folder.\n\n"
            logging.error(
                remove_ansi_escape_sequences(
                    "No .pth or .index file found in the logs folder."
                )
            )
            raise Exception("No .pth or .index file found in the logs folder.")

        model_folder_path = os.path.dirname(model_files["pth"])
        file_name = os.path.splitext(os.path.basename(model_files["pth"]))[0]

        name = model_name if model_name else file_name
        model_info = {
            "id": model_id,
            "downloaded_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "name": name,
            "epochs": model_epochs,
            "algorithm": model_algorithm,
            "author": author,
            "from": server,
            "link": modelLink,
            "model_folder_path": model_folder_path,
            "model_pth_file": model_files["pth"],
            "model_index_file": model_files["index"],
        }

        os.makedirs(MODELS_DIR, exist_ok=True)
        logging.info(f"Attempting to create directory: {MODELS_DIR}")

        try:
            if not os.path.exists(MODELS_DIR):
                os.makedirs(MODELS_DIR)
                logging.info(f"Created directory: {MODELS_DIR}")
            else:
                logging.info(f"Directory already exists: {MODELS_DIR}")
        except OSError as e:
            logging.error(f"Error creating directory {MODELS_DIR}: {str(e)}")
            yield f"data: Error creating directory {MODELS_DIR}: {str(e)}\n\n"
            handle_exception(e)

        log_file_path = os.path.abspath(
            os.path.join(
                MODELS_DIR,
                f"{model_id}.json",
            )
        )
        logging.info(f"Saving model info to: {log_file_path}")

        with open(log_file_path, "w") as log_file:
            json.dump(model_info, log_file, indent=4)

        yield f"data: Model info saved in {log_file_path}.\n\n"
        logging.info(
            remove_ansi_escape_sequences(f"Model info saved in {log_file_path}.")
        )

        yield "data: Model downloaded successfully.\n\n"
        logging.info(remove_ansi_escape_sequences("Model downloaded successfully."))

    except Exception as e:
        error_message = str(e)
        logging.error(f"Error running download: {error_message}")
        handle_exception(e)
        yield f"data: Error running download: {error_message}\n\n"


# import local model
def import_model():
    model_path = request.args.get("path")
    model_id = request.args.get("id")

    if not model_path:
        return {"status": "error", "message": "Model path is required"}, 400

    if not os.path.exists(model_path):
        return {"status": "error", "message": "Model path does not exist"}, 400

    os.makedirs(MODELS_DIR, exist_ok=True)

    model_folder_name = os.path.basename(model_path.rstrip(os.sep))
    dest_model_path = os.path.join(RVC_LOGS_DIR, model_folder_name)

    try:
        shutil.copytree(model_path, dest_model_path)
        logging.info(f"Model imported successfully on: {dest_model_path}")
    except Exception as e:
        logging.error(f"Error importing model: {str(e)}")
        return {"status": "error", "message": f"Error importing model: {str(e)}"}, 500

    model_files = {"pth": None, "index": None}
    for root, _, files in os.walk(dest_model_path):
        for file in files:
            if file.endswith(".pth"):
                model_files["pth"] = os.path.join(root, file)
            elif file.endswith(".index"):
                model_files["index"] = os.path.join(root, file)
        if model_files["pth"] and model_files["index"]:
            break

    if not model_files["pth"] or not model_files["index"]:
        missing_files = []
        if not model_files["pth"]:
            missing_files.append(".pth")
        if not model_files["index"]:
            missing_files.append(".index")
        return {
            "status": "error",
            "message": f"Missing required files: {', '.join(missing_files)}",
        }, 400

    model_info = {
        "id": model_id,
        "downloaded_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "name": model_folder_name,
        "model_folder_path": dest_model_path,
        "model_pth_file": model_files["pth"],
        "model_index_file": model_files["index"],
    }
    json_file_path = os.path.join(MODELS_DIR, f"{model_id}.json")

    try:
        with open(json_file_path, "w") as json_file:
            json.dump(model_info, json_file, indent=4)
            logging.info(f"Model info saved in {json_file_path}.")
    except Exception as e:
        logging.error(f"Error saving model info: {str(e)}")
        return {"status": "error", "message": f"Error saving model info: {str(e)}"}, 500

    return {
        "status": "success",
        "message": f"Model imported successfully to {dest_model_path}",
        "model_info": model_info,
    }, 200


# get models
def get_models():
    json_files = []

    for file_name in os.listdir(MODELS_DIR):
        if file_name.endswith(".json"):
            file_path = os.path.join(MODELS_DIR, file_name)

            with open(file_path, "r", encoding="utf-8") as json_file:
                try:
                    content = json.load(json_file)
                    json_files.append(content)
                except json.JSONDecodeError as e:
                    logging.error(f"error reading {file_name}: {e}")
                    handle_exception(e)

    return json_files


# delete model
def delete_model_json(id):

    json_file = os.path.join(MODELS_DIR, f"{id}.json")

    if not os.path.exists(json_file):
        logging.info(f"The file {json_file} does not exist.")
        return {"status": "error", "message": f"The file {json_file} does not exist."}

    with open(json_file, "r") as file:
        data = json.load(file)

    folder_path = data.get("model_folder_path")
    if not folder_path:
        logging.info("Path not found in the JSON.")
        return {"status": "error", "message": "Path not found in the JSON."}

    if os.path.exists(folder_path):
        shutil.rmtree(folder_path)
        logging.info(f"The folder {folder_path} has been deleted.")
    else:
        logging.info(f"The folder {folder_path} does not exist.")

    os.remove(json_file)
    logging.info(f"The file {json_file} has been deleted.")
    return {
        "status": "success",
        "message": f"The file {json_file} and folder {folder_path} have been deleted.",
    }


# delete all models
def delete_models_folder():

    if os.path.exists(MODELS_DIR):
        with open(MODELS_DIR, "r") as file:
            try:
                data = json.load(file)
                folder_path = data.get("model_folder_path", [])

                if not folder_path:
                    logging.info("Path not found in the JSON.")
                    return {"status": "error", "message": "Path not found in the JSON."}

                if os.path.exists(folder_path):
                    shutil.rmtree(folder_path)
                    logging.info(f"The folder {folder_path} has been deleted.")
                else:
                    logging.info(f"The folder {folder_path} does not exist.")

                os.remove(MODELS_DIR)
                logging.info(f"The file {MODELS_DIR} has been deleted.")

                return {
                    "status": "success",
                    "message": f"The folder {folder_path} has been deleted.",
                }

            except Exception as e:
                logging.error(f"Error: {e}")
                handle_exception(e)
    else:
        logging.info(f"The folder {MODELS_DIR} does not exist.")
        return {
            "status": "error",
            "message": f"The folder {MODELS_DIR} does not exist.",
        }


# delete inference audio
def delete_inference_audio(id):
    json_file = os.path.join(INFERENCE_LOGS_DIR, f"{id}.json")

    if not os.path.exists(json_file):
        logging.info(f"The file {json_file} does not exist.")
        return {"status": "error", "message": f"The file {json_file} does not exist."}

    with open(json_file, "r") as file:
        data = json.load(file)

    folder_path = data.get("audio_output")
    if not folder_path:
        logging.info("Path not found in the JSON.")
        return {"status": "error", "message": "Path not found in the JSON."}

    if os.path.exists(folder_path):
        os.remove(folder_path)
        logging.info(f"The folder {folder_path} has been deleted.")
    else:
        logging.info(f"The folder {folder_path} does not exist.")

    os.remove(json_file)
    logging.info(f"The file {json_file} has been deleted.")
    return {
        "status": "success",
        "message": f"The file {json_file} and folder {folder_path} have been deleted.",
    }


# delete all inferences results
def delete_inferences_folder():

    shutil.rmtree(INFERENCE_LOGS_DIR)
    logging.info(f"The folder {INFERENCE_LOGS_DIR} has been deleted.")

    shutil.rmtree(OUTPUT_AUDIO_DIR)
    logging.info(f"The folder {OUTPUT_AUDIO_DIR} has been deleted.")

    return {"status": "success", "message": "All inferences results have been deleted."}


# upload audio
def upload_audio():
    if "audio" not in request.files:
        return {"error": "No file part"}, 400

    file = request.files["audio"]

    if file.filename == "":
        return {"error": "No selected file"}, 400

    file_path = os.path.join(INPUT_AUDIO_DIR, file.filename)
    file.save(file_path)

    return {"message": "File uploaded successfully", "file_path": file_path}, 200


# convert
def convert(
    input_path,
    pth_path,
    index_path,
    pitch,
    indexRate,
    filterRadius,
    autotune,
    cleanaudio,
    exportformat,
    name,
):
    unique_id = str(uuid.uuid4())
    audio_path = os.path.join(OUTPUT_AUDIO_DIR, f"{unique_id}.{exportformat}")

    command = [
        os.path.join("env", "python.exe"),
        "rvc_cli.py",
        "infer",
        "--input_path",
        input_path,
        "--output_path",
        audio_path,
        "--pth_path",
        pth_path,
        "--index_path",
        index_path,
        "--pitch",
        pitch,
        "--index_rate",
        indexRate,
        "--filter_radius",
        filterRadius,
        "--f0_autotune",
        autotune,
        "--clean_audio",
        cleanaudio,
        "--export_format",
        exportformat,
    ]

    logging.info(remove_ansi_escape_sequences(f"command: {' '.join(command)}"))
    logging.info(remove_ansi_escape_sequences(f"command_path: {RVC_DIR}"))

    yield "data: Starting conversion...\n\n"
    logging.info(remove_ansi_escape_sequences("Starting conversion..."))

    try:
        process = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            shell=True,
            cwd=RVC_DIR,
        )

        for line in process.stdout:
            yield f"data: {line}\n\n"
            logging.info(line.strip())

        process.stdout.close()
        process.kill()

        yield f"data: Conversion finished. Audio path: {audio_path}\n\n"
        finished_time = datetime.now().isoformat()
        conversion_info = {
            "id": unique_id,
            "model_name": name,
            "converted_at": finished_time,
            "audio_input": input_path,
            "audio_output": audio_path,
            "model_pth": pth_path,
            "model_index": index_path,
            "pitch": pitch,
            "indexRate": indexRate,
            "filterRadius": filterRadius,
            "autotune": autotune,
            "cleanaudio": cleanaudio,
            "exportformat": exportformat,
        }

        logging.info(f"Attempting to create directory: {INFERENCE_LOGS_DIR}")

        try:
            if not os.path.exists(INFERENCE_LOGS_DIR):
                os.makedirs(INFERENCE_LOGS_DIR)
                logging.info(f"Created directory: {INFERENCE_LOGS_DIR}")
            else:
                logging.info(f"Directory already exists: {INFERENCE_LOGS_DIR}")
        except OSError as e:
            logging.error(f"Error creating directory {INFERENCE_LOGS_DIR}: {str(e)}")
            yield f"data: Error creating directory {INFERENCE_LOGS_DIR}: {str(e)}\n\n"
            handle_exception(e)

        log_file_path = os.path.join(INFERENCE_LOGS_DIR, f"{unique_id}.json")
        logging.info(f"Saving conversion info to: {log_file_path}")

        with open(log_file_path, "w") as log_file:
            json.dump(conversion_info, log_file, indent=4)

        yield f"data: Conversion info saved in {log_file_path}.\n\n"
        logging.info(
            remove_ansi_escape_sequences(f"Conversion info saved in {log_file_path}.")
        )

    except Exception as e:
        yield f"data: Error running conversion: {str(e)}\n\n"
        logging.error(
            remove_ansi_escape_sequences(f"Error running conversion: {str(e)}")
        )
        handle_exception(e)


# get inferences
def fetch_inferences():

    json_files = [
        file for file in os.listdir(INFERENCE_LOGS_DIR) if file.endswith(".json")
    ]

    if not json_files:
        return "No inferences found"

    inferences = []
    for file in json_files:
        with open(os.path.join(INFERENCE_LOGS_DIR, file), "r") as f:
            try:
                data = json.load(f)
                inferences.append(data)
            except json.JSONDecodeError as e:
                handle_exception(e)

    return inferences


# stop server
def shutdown_server():
    print("Shutting down...")
    os.kill(os.getpid(), signal.SIGINT)


@app.route("/")
def home():
    client_ip = request.remote_addr
    logging.info(remove_ansi_escape_sequences(f"Request from {client_ip}"))
    return jsonify({"status": "Hello from server!"}), 200


@app.get("/stop")
def shutdown():
    response = jsonify({"message": "Server stopped."})

    threading.Timer(1.0, shutdown_server).start()

    return response, 200


@app.route("/favicon.ico")
def favicon():
    return "", 204

@app.route("/delete-rvc")
def delete_rvc_route():
    if os.path.exists(RVC_DIR):
        logging.info(f"Deleting {RVC_DIR}...")
        logging.info(f"Deleting {VERSION_FILE}...")

        try:
            shutil.rmtree(RVC_DIR)
            os.remove(VERSION_FILE)
        except Exception as e:
            handle_exception(e)
    logging.info("Successfully deleted")
    return "Successfully deleted RVC", 200

@app.get("/send-data")
def send_data_route():
    should_send = request.args.get("send")
    if should_send in ["true", "false"]:
        result = set_send_data(should_send == "true")
        return jsonify(result), 200
    else:
        result = get_send_data()
        return jsonify(result), 200


@app.get("/device-id")
def get_device_id_route():
    device_id = get_device_id()
    return jsonify({"device_id": device_id}), 200


@app.get("/get-latest-models")
def get_latest_models():
    logging.info("Getting latest models...")
    models = get_latest_files(RVC_LOGS_DIR)

    return jsonify(models), 200


@app.route("/delete-model", methods=["GET"])
def delete_model():
    model_id = request.args.get("id")

    if not model_id:
        return jsonify({"status": "error", "message": "Model ID is required"}), 400

    result = delete_model_json(model_id)
    return jsonify(result)


@app.route("/delete-all-models", methods=["GET"])
def delete_all_models():
    result = delete_models_folder()
    return jsonify(result)


@app.route("/delete-inference", methods=["GET"])
def delete_inference():
    model_id = request.args.get("id")

    if not model_id:
        return jsonify({"status": "error", "message": "Inference ID is required"}), 400

    result = delete_inference_audio(model_id)
    return jsonify(result)


@app.route("/delete-all-inferences", methods=["GET"])
def delete_all_inferences():
    result = delete_inferences_folder()
    return jsonify(result)


@app.get("/check-rvc")
def check_rvc_repo():
    logging.info("Checking for RVC repository...")
    exists = RVC_repository_exists() 
    return jsonify({"exists": exists})  

@app.route("/pre-install", methods=["GET"])
def pre_install():
    return Response(downloadRepo(), content_type="text/event-stream")


@app.route("/pretraineds", methods=["GET"])
def download_pretraineds():
    return Response(downloadPretraineds(), content_type="text/event-stream")


@app.route("/check-update", methods=["GET"])
def check_update():
    logging.info(remove_ansi_escape_sequences("Checking for updates..."))
    return Response(checkUpdate(), content_type="text/event-stream")


@app.route("/download", methods=["GET"])
def download_model():
    model_name = request.args.get("name")
    model_link = request.args.get("link")
    model_id = request.args.get("id")
    model_epochs = request.args.get("epochs")
    model_algorithm = request.args.get("algorithm")
    author = request.args.get("author")
    server = request.args.get("from")
    logging.info(remove_ansi_escape_sequences(f"model_link: {model_link}"))
    if not model_link:
        logging.error(
            remove_ansi_escape_sequences("Error: model link argument is missing.")
        )
        return Response("Error: model link argument is missing.", status=400)

    return Response(
        downloadModel(
            model_link,
            model_id,
            model_epochs,
            model_algorithm,
            model_name,
            author,
            server,
        ),
        content_type="text/event-stream",
    )


@app.route("/import-model", methods=["GET"])
def import_model_route():
    return import_model()


@app.route("/get-models", methods=["GET"])
def get_all_models():
    logging.info(remove_ansi_escape_sequences("Getting all models..."))
    models = get_models()

    return jsonify(models), 200


@app.route("/upload", methods=["POST"])
def upload():
    logging.info(remove_ansi_escape_sequences("Getting audio..."))
    audios = upload_audio()

    return jsonify(audios), 200


@app.route("/convert", methods=["GET"])
def convert_audio():
    input_path = request.args.get("input")
    pth_path = request.args.get("pth")
    index_path = request.args.get("index")
    pitch = request.args.get("pitch")
    indexRate = request.args.get("indexRate")
    filterRadius = request.args.get("filterRadius")
    autotune = request.args.get("autotune")
    cleanaudio = request.args.get("cleanaudio")
    exportformat = request.args.get("exportformat")
    name = request.args.get("name")
    logging.info(remove_ansi_escape_sequences("Getting conversion info..."))
    if not input_path or not pth_path or not index_path or not pitch:
        logging.error(remove_ansi_escape_sequences("Error: arguments missing."))
        return Response("Error: arguments missing", status=400)

    return Response(
        convert(
            input_path,
            pth_path,
            index_path,
            pitch,
            indexRate,
            filterRadius,
            autotune,
            cleanaudio,
            exportformat,
            name,
        ),
        content_type="text/event-stream",
    )


@app.route("/get-inferences", methods=["GET"])
def get_inferences():
    logging.info(remove_ansi_escape_sequences("Getting inferences..."))
    inferences = fetch_inferences()

    return jsonify(inferences), 200


@app.route("/audio", methods=["GET"])
def get_audio():
    audio_path = request.args.get("path")
    return send_file(audio_path, mimetype="audio/wav")


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else find_available_port()

    print(f"Server started at: http://127.0.0.1:{port}")
    logging.info(
        remove_ansi_escape_sequences(f"Server started at: http://127.0.0.1:{port}")
    )
    app.run(port=port, host="0.0.0.0", debug=False)
    logging.info(remove_ansi_escape_sequences("Server stopped"))
