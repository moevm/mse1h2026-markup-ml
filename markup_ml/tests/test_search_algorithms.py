import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import pytest
from app.core.hyperparameter_search import grid_search_params
from app.core.random_search_combinations import random_search_params

def test_grid_search_params_base_case():
    assert grid_search_params({"lr0": [0.01, 0.00001], "test" : ["test1", "test2"]}) == [{'lr0': 0.01, 'test': 'test1'}, {'lr0': 0.01, 'test': 'test2'}, {'lr0': 1e-05, 'test': 'test1'}, {'lr0': 1e-05, 'test': 'test2'}]
    
def test_grid_search_params_empty_list():   
    assert grid_search_params({"empty_param": [], "lr": [1, 2]}) == []

def test_grid_search_params_fixed_parameter():
    assert grid_search_params({"lr0": [1], "str": ["s1", "s2"]}) == [{'lr0': 1, 'str': 's1'}, {'lr0': 1, 'str': 's2'}]

def test_grid_search_params_full_empty():
    assert grid_search_params({"lr0": [], "test": []}) == []

def test_random_search_params_base_case():
    generated_params = random_search_params({"lr0": [1, 3], "test": ["test1", "test2"]}, 2)
    answer = False
    if len(generated_params) == 2:
        answer = True
        for dict in generated_params:
            if len(dict) != 2:
                answer = False
    assert answer == True 

def test_random_search_params_invalid_combination_count():
    generated_params = random_search_params({"epochs": [1, 2], "test": ["test1", "test2"]}, 10)
    
    flag = False
    true_params = [{'epochs': 2, 'test': 'test2'}, {'epochs': 2, 'test': 'test1'}, {'epochs': 1, 'test': 'test1'}, {'epochs': 1, 'test': 'test2'}]
    if len(generated_params) == 4:
        flag = True
        for combination in generated_params:
            if combination not in true_params:
                flag = False
    assert flag == True

def test_random_search_params_with_tuple_ranges():
    param_ranges = {
        "learning_rate": (0.001, 0.1), 
        "batch_size": (32, 128),         
        "dropout": (0.1, 0.5)           
    }
    result = random_search_params(param_ranges, n_iter=5)
    
    assert len(result) == 5
    
    for combo in result:
        assert 0.001 <= combo["learning_rate"] <= 0.1
        assert 32 <= combo["batch_size"] <= 128
        assert 0.1 <= combo["dropout"] <= 0.5
        assert isinstance(combo["batch_size"], int) 

def test_random_search_params_unique_combinations():
    param_ranges = {
        "param1": [1, 2, 3],
        "param2": ["a", "b", "c"],
        "param3": (0.1, 0.5)
    }
    result = random_search_params(param_ranges, n_iter=10)
    assert len(result) == len(set(str(combo) for combo in result))

def test_random_search_params_more_than_possible():
    param_ranges = {
        "color": ["red", "blue"],
        "size": ["small", "large"]
    }
    result = random_search_params(param_ranges, n_iter=10)
    assert len(result) == 4
    expected_combinations = [
        {"color": "red", "size": "small"},
        {"color": "red", "size": "large"},
        {"color": "blue", "size": "small"},
        {"color": "blue", "size": "large"}
    ]
    
    for combo in expected_combinations:
        assert combo in result

def test_random_search_params_empty_input():
    assert random_search_params({}) == []
    assert random_search_params({}, n_iter=5) == []