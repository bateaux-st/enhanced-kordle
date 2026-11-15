"""scripts/smoke.py를 import하지 않고 정의만 꺼내 온다. import하면 모듈 최상위가 실제 HTTP를 친다."""
import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SMOKE = ROOT / "scripts" / "smoke.py"


def load_smoke(*names):
    """smoke.py의 최상위 import와 지정한 이름의 대입·함수만 실행해 그 이름들을 담은 dict로 돌려준다."""
    tree = ast.parse(SMOKE.read_text(encoding="utf-8"))
    keep = []
    for node in tree.body:
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            keep.append(node)
        elif isinstance(node, ast.FunctionDef) and node.name in names:
            keep.append(node)
        elif isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id in names for t in node.targets):
            keep.append(node)
    ns = {}
    exec(compile(ast.Module(body=keep, type_ignores=[]), str(SMOKE), "exec"), ns)
    missing = [n for n in names if n not in ns]
    if missing:
        raise AssertionError(f"smoke.py에서 못 찾은 정의: {missing}")
    return {n: ns[n] for n in names}
