import random
from typing import Dict, List, Any, Tuple

def random_search_params(param_ranges: Dict[str, Tuple], n_iter: int = 10) -> List[Dict[str, Any]]:
    if not param_ranges:
        return []

    combinations = []


    for _ in range(n_iter):
        combo = {}
        unique_flag = False
        generate_count = 0
        while not unique_flag and generate_count < 10:
            for key, params in param_ranges.items():
                if len(params) == 0:
                    continue

                if len(params) == 1:
                    combo[key] = params[0]
                else:
                    if isinstance(params[0], int) and isinstance(params[1], int):

                        combo[key] = random.randint(params[0], params[1])
                    elif isinstance(params[0], float) or isinstance(params[1], float):

                        combo[key] = random.uniform(params[0], params[1])

                    elif isinstance(params[0], str) or isinstance(params[1], str):
                        combo[key] = params[random.randint(0, len(params) - 1)]

                    else:
                        combo[key] = random.uniform(float(params[0]), float(params[1]))               
            
            generate_count += 1

            if combo not in combinations:
                combinations.append(combo)
                unique_flag = True

    return combinations
