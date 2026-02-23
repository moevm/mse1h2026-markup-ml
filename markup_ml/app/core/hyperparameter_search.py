from itertools import product
from typing import Dict, List, Any

def grid_search_params(param_grid: Dict[str, List[Any]]) -> List[Dict[str, Any]]:
    param_grid_copy = {}
    for key in param_grid.keys():
        if param_grid[key] != []:
            param_grid_copy[key] = param_grid[key]

    keys = param_grid_copy.keys()
    values = param_grid_copy.values()
    combinations = [dict(zip(keys, combo)) for combo in product(*values)]
    return combinations
