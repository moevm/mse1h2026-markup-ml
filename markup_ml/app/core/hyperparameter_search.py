from itertools import product
from typing import Dict, List, Any

def grid_search_params(param_grid: Dict[str, List[Any]]) -> List[Dict[str, Any]]:

    if not param_grid:
        return []

    keys = param_grid.keys()
    values = param_grid.values()
    combinations = [dict(zip(keys, combo)) for combo in product(*values)]

    return combinations