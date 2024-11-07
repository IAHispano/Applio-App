from flask import Flask, jsonify, request, Response, send_file
from flask_cors import CORS
import os
import requests
import zipfile
import io
import logging
import re
import subprocess
import json
import signal
import threading
from requests.exceptions import HTTPError
from datetime import datetime
import sys
import uuid
import ctypes
import socket
import shutil
from urllib.parse import unquote

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

# define logs
log_directory = os.path.abspath(os.path.join(os.getcwd(), 'logs'))
log_file = os.path.join(log_directory, 'server_log.log')

# create log directory if it doesn't exist
if not os.path.exists(log_directory):
    os.makedirs(log_directory)

# configure logging
logging.basicConfig(filename=log_file, 
                    level=logging.INFO, 
                    format='%(asctime)s - %(levelname)s - %(message)s')
logging.getLogger('flask').setLevel(logging.ERROR)
logging.getLogger('werkzeug').setLevel(logging.ERROR)

# remove ANSI from logs
def remove_ansi_escape_sequences(log_line):
    ansi_escape = re.compile(r'(?:\x1B[@-_][0-?]*[ -/]*[@-~])')
    return ansi_escape.sub('', log_line)

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

        if response.status_code == 403 and "X-RateLimit-Remaining" in response.headers and response.headers["X-RateLimit-Remaining"] == "0":
            reset_time = response.headers.get("X-RateLimit-Reset")
            return None

        commit_data = response.json()
        return {"commit_hash": commit_data['sha']}
    
    except HTTPError as http_err:
        return {"error": f"HTTP error occurred: {http_err}"}
    
    except Exception as err:
        return {"error": f"An error occurred: {err}"}


# save last commit hash to version.json
def save_commit_info(commit_hash):
    if not commit_hash:
        logging.info("No commit hash to save due to an error or rate limit.")
        return

    version_file_path = os.path.abspath(os.path.join(os.getcwd(), 'version.json'))
    logging.info(f"Saving commit {commit_hash} to {version_file_path}")
    with open(version_file_path, 'w') as version_file:
        json.dump({'commit_hash': commit_hash}, version_file)
    logging.info(f"Saved commit {commit_hash} to version.json")

# load last commit hash from version.json
def load_commit_info():
    version_file_path = os.path.abspath(os.path.join(os.getcwd(), 'version.json'))
    logging.info(f"Loading commit info from {version_file_path}")
    if not os.path.exists(version_file_path):
        logging.info("No commit info found.")
        return None
    with open(version_file_path, 'r') as version_file:
        data = json.load(version_file)
        return data.get('commit_hash')
    
def checkUpdate():
    latest_commit_hash = get_latest_commit_hash()
    saved_commit_hash = load_commit_info()

    if saved_commit_hash == latest_commit_hash:
        logging.info("RVC repository is up to date. No need to download.")
        yield 'data: RVC repository is up to date. No need to download.\n\n'
        return False
    
def is_admin():
    try:
        return ctypes.windll.shell32.IsUserAnAdmin()
    except:
        return False
    
def RVC_repository_exists():
    repository_exists = os.path.exists(os.path.join(os.getcwd(), 'rvc'))
    logging.info(f"RVC repository exists: {repository_exists}")
    return str(repository_exists)

# download RVC repository from GitHub and extract it
def downloadRepo():
    extraction_path = os.path.abspath(os.path.join(os.getcwd()))
    new_folder_name = os.path.join(extraction_path, 'rvc')

    latest_commit_hash = get_latest_commit_hash()
    logging.info(f"Latest commit hash: {latest_commit_hash}")

    saved_commit_hash = load_commit_info()

    if saved_commit_hash == latest_commit_hash:
        logging.info("RVC repository is up to date. No need to download.")
        yield 'data: RVC repository is up to date. No need to download.\n\n'
        return


    yield 'data: Downloading RVC repository from GitHub...\n\n'
    
    url = "https://github.com/blaisewf/rvc-cli/archive/refs/heads/main.zip"
    logging.info(remove_ansi_escape_sequences("Downloading RVC repository from GitHub..."))

    try:
        response = requests.get(url, stream=True)
        response.raise_for_status()
        yield 'data: Downloading RVC repository from GitHub... Done!\n\n'
        logging.info(remove_ansi_escape_sequences("Downloading RVC repository from GitHub... Done!"))

        os.makedirs(extraction_path, exist_ok=True)

        with zipfile.ZipFile(io.BytesIO(response.content)) as zip_file:
            zip_file.extractall(extraction_path)
            yield 'data: Extracting RVC repository from GitHub... Done!\n\n'

        old_folder_name = os.path.join(extraction_path, 'rvc-cli-main')

        if os.path.exists(new_folder_name):
            shutil.rmtree(new_folder_name) 
            logging.info(remove_ansi_escape_sequences(f"Removed existing folder: {new_folder_name}"))

        if os.path.exists(old_folder_name):
            os.rename(old_folder_name, new_folder_name)
            yield 'data: Renaming extracted folder to "rvc"... Done!\n\n'
            logging.info(remove_ansi_escape_sequences(f"Renamed folder from 'rvc-cli-main' to 'rvc'"))

        yield 'data: RVC repository downloaded successfully.\n\n'
        save_commit_info(latest_commit_hash)
        logging.info(f"Saved commit {latest_commit_hash} to version.json")
        yield from runInstallation()

    except requests.RequestException as e:
        logging.error(remove_ansi_escape_sequences(f"Error downloading RVC repository from GitHub: {str(e)}"))
        yield 'data: Error downloading RVC repository from GitHub.\n\n'
    except zipfile.BadZipFile:
        logging.error(remove_ansi_escape_sequences("Error: Bad ZIP file"))
        yield 'data: Error: Bad ZIP file.\n\n'
    except OSError as e:
        logging.error(remove_ansi_escape_sequences(f"Error during extraction: {str(e)}"))
        yield 'data: Error during extraction.\n\n'

def downloadPretraineds():
    bat_file_path = os.path.join(os.path.abspath(os.path.join(os.getcwd(), 'rvc')))
    command = [os.path.join("env", "python.exe"), "rvc_cli.py", "prerequisites"]
    
    logging.info(f'command: {command}')
    logging.info(f'path: {bat_file_path}')
    print(command)
    print(bat_file_path)
    yield 'data: Starting installation...\n\n'

    try:
        process = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,  
            text=True,
            bufsize=1,
            shell=True, 
            cwd=bat_file_path
        )
        
        for line in process.stdout:
            if line: 
                yield f'data: {line}\n\n'
                logging.info(f'data: {line}\n\n')
        
        process.wait()  
        
        if process.returncode == 0:
            yield 'data: Pretraineds installed successfully.\n\n'
        else:
            yield f'data: Installation failed with return code {process.returncode}\n\n'
        
    except Exception as e:
        yield f'data: Error running installation: {str(e)}\n\n'

# run RVC installation
def runInstallation():
    bat_file_path = os.path.join(os.path.abspath(os.path.join(os.getcwd(), 'rvc')), 'install.bat')

    yield 'data: Starting installation...\n\n'
    logging.info(remove_ansi_escape_sequences("Starting installation..."))

    try:
        process = subprocess.Popen(
            [bat_file_path],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            shell=True,
            cwd=os.path.abspath(os.path.join(os.getcwd(), 'rvc'))
        )

        for line in process.stdout:
            yield f'data: {line}\n\n'
            logging.info(line.strip())

        process.stdout.close()
        process.kill()

        yield 'data: Installation completed successfully.\n\n'
        logging.info(remove_ansi_escape_sequences("Installation completed successfully."))

    except Exception as e:
        yield f'data: Error running installation: {str(e)}\n\n'
        logging.error(remove_ansi_escape_sequences(f"Error running installation: {str(e)}"))

# get latest downloaded model
def get_latest_files(directory):
    model_files = {"pth": None, "index": None}
    latest_times = {"pth": 0, "index": 0}

    for root, dirs, files in os.walk(directory):
        for file in files:
            file_path = os.path.join(root, file)
            file_mtime = os.path.getmtime(file_path) 

            if file.endswith('.pth') and file_mtime > latest_times["pth"]:
                model_files["pth"] = file_path
                latest_times["pth"] = file_mtime

            elif file.endswith('.index') and file_mtime > latest_times["index"]:
                model_files["index"] = file_path
                latest_times["index"] = file_mtime

    logging.info(f"Model .pth file found: {model_files['pth']}")
    logging.info(f"Model .index file found: {model_files['index']}")

    if not model_files["pth"] or not model_files["index"]:
        return None

    return model_files

# download model
def downloadModel(modelLink, model_id, model_epochs, model_algorithm, model_name, author, server):
    command = [os.path.join("env", "python.exe"), "rvc_cli.py", "download", "--model_link", f'"{unquote(modelLink)}"']
    command_path = os.path.abspath(os.path.join(os.getcwd(), 'rvc'))

    logging.info(remove_ansi_escape_sequences(f"command: {' '.join(command)}"))
    logging.info(remove_ansi_escape_sequences(f"command_path: {command_path}"))

    yield 'data: Downloading model...\n\n'
    logging.info(remove_ansi_escape_sequences("Downloading model..."))

    try:
        process = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            shell=True,
            cwd=command_path
        )

        for line in process.stdout:
            yield f'data: {line}\n\n'
            logging.info(line.strip())

            if "error" in line.lower():
                yield 'data: Error detected during download process. Stopping execution.\n\n'
                logging.error("Error detected in download process.")
                return 

        process.stdout.close()
        process.kill()

        if process.returncode != 0:
            error_message = process.stderr.read()
            logging.error(f"Error downloading model: {error_message}")
            yield 'data: Error downloading model.\n\n'
            return 

        logs_dir = os.path.abspath(os.path.join(os.getcwd(), 'rvc', 'logs'))
        logging.info(f"Logs directory: {logs_dir}")

        model_files = get_latest_files(logs_dir)

        if not model_files or not model_files.get("pth") or not model_files.get("index"):
            yield 'data: Error: No .pth or .index file found in the logs folder.\n\n'
            logging.error(remove_ansi_escape_sequences("No .pth or .index file found in the logs folder."))
            return

        model_folder_path = os.path.dirname(model_files["pth"])
        file_name = os.path.splitext(os.path.basename(model_files["pth"]))[0]

        name = model_name if model_name else file_name
        model_info = {
            "id": model_id,
            "name": name,
            "epochs": model_epochs,
            "algorithm": model_algorithm,
            "author": author,
            "from": server,
            "link": modelLink,
            "model_folder_path": model_folder_path,
            "model_pth_file": model_files["pth"],
            "model_index_file": model_files["index"]
        }

        json_logs_dir = os.path.abspath(os.path.join(os.getcwd(), 'logs', 'models'))
        logging.info(f"Attempting to create directory: {json_logs_dir}")

        try:
            if not os.path.exists(json_logs_dir):
                os.makedirs(json_logs_dir)
                logging.info(f"Created directory: {json_logs_dir}")
            else:
                logging.info(f"Directory already exists: {json_logs_dir}")
        except OSError as e:
            logging.error(f"Error creating directory {json_logs_dir}: {str(e)}")
            yield f'data: Error creating directory {json_logs_dir}: {str(e)}\n\n'
            return

        log_file_path = os.path.join(json_logs_dir, f'{model_id}.json')
        logging.info(f"Saving model info to: {log_file_path}")

        with open(log_file_path, 'w') as log_file:
            json.dump(model_info, log_file, indent=4)

        yield f'data: Model info saved in {log_file_path}.\n\n'
        logging.info(remove_ansi_escape_sequences(f"Model info saved in {log_file_path}."))

        yield 'data: Model downloaded successfully.\n\n'
        logging.info(remove_ansi_escape_sequences("Model downloaded successfully."))

    except Exception as e:
        yield f'data: Error running download: {str(e)}\n\n'
        logging.error(remove_ansi_escape_sequences(f"Error running download: {str(e)}"))



# get models
def get_models():
    json_logs_dir = os.path.abspath(os.path.join(os.getcwd(), 'logs', 'models'))

    json_files = []

    for file_name in os.listdir(json_logs_dir):
        if file_name.endswith('.json'):
            file_path = os.path.join(json_logs_dir, file_name)
            
            with open(file_path, 'r', encoding='utf-8') as json_file:
                try:
                    content = json.load(json_file) 
                    json_files.append(content) 
                except json.JSONDecodeError as e:
                    print(f"error reading {file_name}: {e}")

    return json_files

# upload audio
def upload_audio():
    audios_dir = os.path.abspath(os.path.join(os.getcwd(), 'audios', 'input'))

    os.makedirs(audios_dir, exist_ok=True)

    if 'audio' not in request.files:
        return {'error': 'No file part'}, 400

    file = request.files['audio']
    
    if file.filename == '':
        return {'error': 'No selected file'}, 400

    file_path = os.path.join(audios_dir, file.filename)
    file.save(file_path)

    return {'message': 'File uploaded successfully', 'file_path': file_path}, 200

# convert
def convert(input_path, pth_path, index_path, pitch, indexRate, filterRadius, autotune, cleanaudio, exportformat):
    unique_id = str(uuid.uuid4())
    output_path = os.path.abspath(os.path.join(os.getcwd(), 'audios', 'output'))
    os.makedirs(output_path, exist_ok=True)
    audio_path = os.path.join(output_path, f'{unique_id}.{exportformat}')

    command = [
    os.path.join("env", "python.exe"), 
    "rvc_cli.py", 
    "infer", 
    "--input_path", input_path, 
    "--output_path", audio_path, 
    "--pth_path", pth_path, 
    "--index_path", index_path,
    "--pitch", pitch,
    "--index_rate", indexRate,
    "--filter_radius", filterRadius,
    "--f0_autotune", autotune,
    "--clean_audio", cleanaudio,
    "--export_format", exportformat
]
    command_path = os.path.abspath(os.path.join(os.getcwd(), 'rvc'))

    logging.info(remove_ansi_escape_sequences(f"command: {' '.join(command)}"))
    logging.info(remove_ansi_escape_sequences(f"command_path: {command_path}"))

    yield 'data: Starting conversion...\n\n'
    logging.info(remove_ansi_escape_sequences("Starting conversion..."))

    try:
        process = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            shell=True,
            cwd=command_path
        )

        for line in process.stdout:
            yield f'data: {line}\n\n'
            logging.info(line.strip())

        process.stdout.close()
        process.kill()

        yield f'data: Conversion finished. Audio path: {audio_path}\n\n'
        finished_time = datetime.now().isoformat()
        conversion_info = {
            "id": unique_id,
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
            "exportformat": exportformat
        }

        json_logs_dir = os.path.abspath(os.path.join(os.getcwd(), 'logs', 'inference'))
        logging.info(f"Attempting to create directory: {json_logs_dir}")

        try:
            if not os.path.exists(json_logs_dir):
                os.makedirs(json_logs_dir)
                logging.info(f"Created directory: {json_logs_dir}")
            else:
                logging.info(f"Directory already exists: {json_logs_dir}")
        except OSError as e:
            logging.error(f"Error creating directory {json_logs_dir}: {str(e)}")
            yield f'data: Error creating directory {json_logs_dir}: {str(e)}\n\n'
            return

        log_file_path = os.path.join(json_logs_dir, f'{unique_id}.json')
        logging.info(f"Saving conversion info to: {log_file_path}")

        with open(log_file_path, 'w') as log_file:
            json.dump(conversion_info, log_file, indent=4)

        yield f'data: Conversion info saved in {log_file_path}.\n\n'
        logging.info(remove_ansi_escape_sequences(f"Conversion info saved in {log_file_path}."))


    except Exception as e:
        yield f'data: Error running conversion: {str(e)}\n\n'
        logging.error(remove_ansi_escape_sequences(f"Error running conversion: {str(e)}"))

# stop server
def shutdown_server():
    print('Shutting down...')
    os.kill(os.getpid(), signal.SIGINT) 

@app.route('/')
def home():
    client_ip = request.remote_addr
    logging.info(remove_ansi_escape_sequences(f"Request from {client_ip}"))
    return jsonify({'status': 'Hello from server!'}), 200

@app.get('/stop')
def shutdown():
    response = jsonify({"message": "Server stopped."})
    
    threading.Timer(1.0, shutdown_server).start() 
    
    return response, 200 

@app.get('/get-latest-models')
def get_latest_models():
    logging.info("Getting latest models...")
    logs_dir = os.path.abspath(os.path.join(os.getcwd(), 'rvc', 'logs'))
    models = get_latest_files(logs_dir)
    
    return jsonify(models), 200

@app.get('/check-rvc')
def check_rvc_repo():
    logging.info("Checking for RVC repository...")
    exists = RVC_repository_exists() 
    return jsonify({"exists": exists}) 

@app.route('/pre-install', methods=['GET'])
def pre_install():
    return Response(downloadRepo(), content_type='text/event-stream')

@app.route('/pretraineds', methods=['GET'])
def download_pretraineds():
    return Response(downloadPretraineds(), content_type='text/event-stream')

@app.route('/check-update', methods=['GET'])
def check_update():
    logging.info(remove_ansi_escape_sequences("Checking for updates..."))
    return Response(checkUpdate(), content_type='text/event-stream')

@app.route('/download', methods=['GET'])
def download_model():
    model_name = request.args.get('name')
    model_link = request.args.get('link')
    model_id = request.args.get('id')
    model_epochs = request.args.get('epochs')
    model_algorithm = request.args.get('algorithm')
    author = request.args.get('author')
    server = request.args.get('from')
    logging.info(remove_ansi_escape_sequences(f"model_link: {model_link}"))
    if not model_link:
        logging.error(remove_ansi_escape_sequences("Error: model link argument is missing."))
        return Response("Error: model link argument is missing.", status=400)
    
    return Response(downloadModel(model_link, model_id, model_epochs, model_algorithm, model_name, author, server), content_type='text/event-stream')

@app.route('/get-models', methods=['GET'])
def get_all_models():
    logging.info(remove_ansi_escape_sequences("Getting all models..."))
    models = get_models()
    
    return jsonify(models), 200

@app.route('/upload', methods=["POST"])
def upload():
    logging.info(remove_ansi_escape_sequences("Getting audio..."))
    audios = upload_audio()

    return jsonify(audios), 200

@app.route('/convert', methods=["GET"])
def convert_audio():
    input_path = request.args.get('input')
    pth_path = request.args.get('pth')
    index_path = request.args.get('index')
    pitch = request.args.get('pitch')
    indexRate = request.args.get('indexRate')
    filterRadius = request.args.get('filterRadius')
    autotune = request.args.get('autotune')
    cleanaudio = request.args.get('cleanaudio')
    exportformat = request.args.get('exportformat')
    logging.info(remove_ansi_escape_sequences('Getting conversion info...'))
    if not input_path or not pth_path or not index_path or not pitch:
        logging.error(remove_ansi_escape_sequences("Error: arguments missing."))
        return Response("Error: arguments missing", status=400)
    
    return Response(convert(input_path, pth_path, index_path, pitch, indexRate, filterRadius, autotune, cleanaudio, exportformat), content_type='text/event-stream')

@app.route('/audio', methods=["GET"])
def get_audio():
    audio_path = request.args.get('path')
    return send_file(audio_path, mimetype='audio/wav')

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else find_available_port()
    launched_from_tauri = "--from-tauri" in sys.argv

    if launched_from_tauri and not is_admin():
        params = f'{port} ' + ' '.join([f'"{arg}"' for arg in sys.argv[1:]])
        ctypes.windll.shell32.ShellExecuteW(None, "runas", sys.executable, params, None, 1)
        sys.exit(0)

    print(f"Server started at: http://127.0.0.1:{port}")
    logging.info(remove_ansi_escape_sequences(f"Server started at: http://127.0.0.1:{port}"))
    app.run(port=port, host='0.0.0.0', debug=False)
    logging.info(remove_ansi_escape_sequences("Server stopped"))
