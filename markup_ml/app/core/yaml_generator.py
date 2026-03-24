import os
import yaml

def generate_yolo_yaml(dataset_path: str, num_classes: int) -> str:
    abs_dataset_path = os.path.abspath(dataset_path)
    os.makedirs(abs_dataset_path, exist_ok=True)

    yaml_data = {
        "path": abs_dataset_path,
        "train": "images/train",  # Пути вводить относительно 'path'
        "val": "images/val",      
        "test": "images/test",    
        "nc": num_classes,
        "names": [f"class_{i}" for i in range(num_classes)]
    }

    yaml_file_path = os.path.join(abs_dataset_path, "data.yaml")
    with open(yaml_file_path, "w", encoding="utf-8") as file_YOLO:
        yaml.dump(yaml_data, file_YOLO, default_flow_style=False, sort_keys=False, allow_unicode=True)
        
    return yaml_file_path

'''
    if __name__ == "__main__":
    # Тестовые входные данные
    test_path = "./my_custom_dataset"
    classes_count = 5
    
    # Генерация
    result_file = generate_yolo_yaml(test_path, classes_count)
    print(f"The file was successfully generated on path\nПуть: {result_file}")
    
    # Проверка содержимого
    print("-" * 30)
    with open(result_file, "r", encoding="utf-8") as f:
        print(f.read())
'''