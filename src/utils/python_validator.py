#!/usr/bin/env python3
"""
Python code validator using AST to filter dangerous operations.
"""
import ast
import sys
import json

# 危险的函数和模块
DANGEROUS_FUNCTIONS = {
    'eval', 'exec', 'compile', '__import__',
    'open', 'input', 'breakpoint',
    'globals', 'locals', 'vars',
}

DANGEROUS_MODULES = {
    'os', 'sys', 'subprocess', 'socket', 'threading', 
    'multiprocessing', '__main__', 'importlib', '__loader__',
    'ctypes', 'pickle', 'marshal', 'traceback', 'dis',
}

DANGEROUS_ATTRIBUTES = {
    '__dict__', '__class__', '__bases__', '__subclasses__',
    '__code__', '__func__', '__globals__', '__builtins__',
    '__loader__', '__package__', '__spec__',
}


class DangerousOperationDetector(ast.NodeVisitor):
    def __init__(self):
        self.dangerous_ops = []
        self.current_line = 0
    
    def visit_Call(self, node: ast.Call) -> None:
        """检测危险的函数调用"""
        self.current_line = node.lineno
        
        # 检查函数名
        func_name = None
        if isinstance(node.func, ast.Name):
            func_name = node.func.id
        elif isinstance(node.func, ast.Attribute):
            if isinstance(node.func.value, ast.Name):
                func_name = f"{node.func.value.id}.{node.func.attr}"
        
        if func_name and func_name in DANGEROUS_FUNCTIONS:
            self.dangerous_ops.append({
                'type': 'dangerous_function',
                'name': func_name,
                'line': node.lineno,
            })
        
        self.generic_visit(node)
    
    def visit_Import(self, node: ast.Import) -> None:
        """检测危险的模块导入"""
        self.current_line = node.lineno
        for alias in node.names:
            module_name = alias.name.split('.')[0]
            if module_name in DANGEROUS_MODULES:
                self.dangerous_ops.append({
                    'type': 'dangerous_import',
                    'name': alias.name,
                    'line': node.lineno,
                })
        self.generic_visit(node)
    
    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        """检测 from...import 导入"""
        self.current_line = node.lineno
        if node.module:
            module_name = node.module.split('.')[0]
            if module_name in DANGEROUS_MODULES:
                self.dangerous_ops.append({
                    'type': 'dangerous_import',
                    'name': node.module,
                    'line': node.lineno,
                })
        self.generic_visit(node)
    
    def visit_Attribute(self, node: ast.Attribute) -> None:
        """检测危险的属性访问"""
        self.current_line = node.lineno
        if node.attr in DANGEROUS_ATTRIBUTES:
            self.dangerous_ops.append({
                'type': 'dangerous_attribute',
                'name': node.attr,
                'line': node.lineno,
            })
        self.generic_visit(node)
    
    def visit_Name(self, node: ast.Name) -> None:
        """检测危险的名称使用"""
        self.current_line = node.lineno
        if node.id in {'__builtins__', '__name__', '__file__'}:
            # 一些特殊名称可能被允许在特定上下文中
            pass
        self.generic_visit(node)


def validate_python_code(code: str) -> dict:
    """
    验证 Python 代码的安全性。
    返回 {'valid': bool, 'errors': list}
    """
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        return {
            'valid': False,
            'errors': [{
                'type': 'syntax_error',
                'message': str(e),
                'line': e.lineno,
            }]
        }
    except Exception as e:
        return {
            'valid': False,
            'errors': [{
                'type': 'parse_error',
                'message': str(e),
            }]
        }
    
    detector = DangerousOperationDetector()
    detector.visit(tree)
    
    if detector.dangerous_ops:
        return {
            'valid': False,
            'errors': detector.dangerous_ops
        }
    
    return {
        'valid': True,
        'errors': []
    }


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({'valid': False, 'errors': [{'type': 'error', 'message': 'No code provided'}]}))
        sys.exit(1)
    
    code = sys.argv[1]
    result = validate_python_code(code)
    print(json.dumps(result))
