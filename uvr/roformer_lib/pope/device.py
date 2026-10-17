from itertools import chain
from functools import wraps

import torch
from torch.nn import Module

from .torch_einops_utils import tree_map_tensor

# helpers

def exists(v):
    return v is not None

# infer the device for a module

def module_device(m: Module):

    first_param_or_buffer = next(chain(m.parameters(), m.buffers()), None)

    if not exists(first_param_or_buffer):
        return None

    return first_param_or_buffer.device

# moving all inputs into a function onto a device

def move_inputs_to_device(device):

    def decorator(fn):
        @wraps(fn)
        def inner(*args, **kwargs):
            args, kwargs = tree_map_tensor(lambda t: t.to(device), (args, kwargs))

            return fn(*args, **kwargs)

        return inner

    return decorator

def move_inputs_to_module_device(fn):

    @wraps(fn)
    def inner(self, *args, **kwargs):
        device = module_device(self)

        if exists(device):
            args, kwargs = tree_map_tensor(lambda t: t.to(device), (args, kwargs))

        return fn(self, *args, **kwargs)

    return inner
