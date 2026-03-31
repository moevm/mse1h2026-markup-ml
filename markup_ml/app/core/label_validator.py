import os
from pathlib import Path


def validate_label_file(dirpath):
    dir_path = Path(dirpath)
    if not dir_path.exists():
        raise FileNotFoundError(f"Папка {dirpath} не найдена!")
    else:
        for child in dir_path.iterdir():
            if os.path.isdir(child):
                raise IsADirectoryError(f"Файл {child} является директорией")

            if child.suffix != ".txt":
                raise ValueError(f"Неправильное расширение файла {child}: ожидается .txt, получено {child.suffix}")

            content = child.read_text()
            print(child)
            for idx, line in enumerate(content.splitlines()):
                params = line.split()
                if len(params) != 5:
                    raise ValueError(
                        f"Неправильный формат в строке {idx} в файле {child}: {line}. Ожидается 5 параметров, получено {len(params)}")
                else:
                    try:
                        check_id = int(params[0])
                    except ValueError:
                        raise ValueError(f"Ошибка в файле {child} в строке {idx}: Id класса должно быть целым числом")

                    for i in range(1, 5):
                        try:
                            param = float(params[i])
                        except ValueError:
                            raise ValueError(
                                f"Ошибка в файле {child} в строке {idx}: невозможно привести параметр '{params[i]}' в формат числа с плавающей точкой")
                        if param < 0 or param > 1:
                            raise ValueError(
                                f"Ошибка в файле {child} в строке {idx}: параметр {param} находится вне диапазона [0, 1]")