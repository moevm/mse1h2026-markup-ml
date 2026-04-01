import random
from typing import Dict, List, Any, Tuple, Union


def random_search_params(param_ranges: Dict[str, Union[Tuple, List]], n_iter: int = 10) -> List[Dict[str, Any]]:
    if not param_ranges:
        return []

    combinations = []
    max_attempts = n_iter * 10

    for attempt in range(max_attempts):
        if len(combinations) >= n_iter:
            break

        combo = {}
        for key, param_value in param_ranges.items():
            if isinstance(param_value, tuple):
                if len(param_value) != 2:
                    raise ValueError("param_value должен содержать два значения!")

                min_val, max_val = param_value
                if isinstance(min_val, int) and isinstance(max_val, int):
                    combo[key] = random.randint(min_val, max_val)
                elif isinstance(min_val, (int, float)) and isinstance(max_val, (int, float)):
                    combo[key] = random.uniform(float(min_val), float(max_val))

                else:
                    raise TypeError(f"Неподдерживаемые типы в диапазоне")

            elif isinstance(param_value, list):
                if not param_value:
                    raise ValueError(f"Пустой список для параметра {key}")
                combo[key] = random.choice(param_value)
            else:
                raise TypeError(f"Неподдерживаемый тип для параметра {key}: {type(param_value)}")
        if combo not in combinations:
            combinations.append(combo)

    if len(combinations) < n_iter:
        print(f"Сгенерировано только {len(combinations)} из {n_iter} уникальных комбинаций")

    return combinations