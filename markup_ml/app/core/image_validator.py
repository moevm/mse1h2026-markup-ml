# Task 1.2.5

import cv2
from pathlib import Path
from typing import List
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def validate_images(dataset_path: str) -> List[str]:
    bad_files: List[str] = []
    path = Path(dataset_path)

    if not path.is_dir():
        raise ValueError(f"Путь '{dataset_path}' неверный")

    image_extensions = {'.jpg', '.jpeg', '.png', '.bmp'}

    for file_path in path.rglob('*'):
        if file_path.is_file() and file_path.suffix.lower() in image_extensions:
            try:
                img = cv2.imread(str(file_path))
                if img is None:
                    raise ValueError("Ошибка чтения изображения")
                if img.shape[0] == 0 or img.shape[1] == 0:
                    raise ValueError("Изображение имеет нулевые размеры")
                logger.info(f"Файл '{file_path}' корректен")
            except Exception as e:
                logger.warning(f"Некорректный файл '{file_path}': {str(e)}")
                bad_files.append(str(file_path))

    if bad_files:
        logger.error(
            f"Найдено {len(bad_files)} некорректных файлов")

    return bad_files


if __name__ == "__main__":
    #пример
    test_path = "/path/to/your/dataset"
    invalid = validate_images(test_path)
    if invalid:
        print("Некорректные файлы:")
        for f in invalid:
            print(f)
    else:
        print("Все изображения подходят")