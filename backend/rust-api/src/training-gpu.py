import json, torch
from rvc.configs.config import get_gpu_info, get_number_of_gpus
devices = []
gpus = []
if torch.cuda.is_available():
    count = torch.cuda.device_count()
    for i in range(count):
        try:
            name = torch.cuda.get_device_name(i)
            mem = int(torch.cuda.get_device_properties(i).total_memory / 1024 / 1024 / 1024 + 0.4)
            item = {'id': str(i), 'name': f'GPU {i}: {name} ({mem} GB)', 'mem': mem}
            devices.append(item)
            gpus.append({'id': str(i), 'name': item['name']})
        except Exception:
            item = {'id': str(i), 'name': f'GPU {i}'}
            devices.append(item)
            gpus.append({'id': str(i), 'name': item['name']})
    if count > 1:
        all_id = '-'.join(map(str, range(count)))
        gpus.append({'id': all_id, 'name': f'All GPUs ({all_id})'})
elif torch.backends.mps.is_available():
    item = {'id': '0', 'name': 'Apple Silicon GPU (MPS)', 'kind': 'mps'}
    devices.append(item)
    gpus.append(item)
gpus.append({'id': '-', 'name': 'CPU'})
print('APPLIO_JSON:' + json.dumps({'count': get_number_of_gpus(), 'info': get_gpu_info(), 'devices': devices, 'gpus': gpus}))
