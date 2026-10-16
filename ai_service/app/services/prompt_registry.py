"""
PromptRegistry: Loads, parses, versions and renders prompts from markdown files in prompts/
with YAML frontmatter (id, version, kind, parameters, golden_tests).
"""
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional
import yaml


class PromptTemplate:
    def __init__(self, prompt_id: str, version: str, kind: str, description: str, parameters: List[str],
                 golden_tests: List[Dict[str, Any]], template: str, file_path: str):
        self.id = prompt_id
        self.version = version
        self.kind = kind
        self.description = description
        self.parameters = parameters
        self.golden_tests = golden_tests
        self.template = template
        self.file_path = file_path

    def render(self, **kwargs) -> str:
        # Check required parameters
        for p in self.parameters:
            if p not in kwargs:
                kwargs[p] = ""
        # Safe replacement for {param}
        res = self.template
        for k, v in kwargs.items():
            res = res.replace(f"{{{k}}}", str(v) if v is not None else "")
        return res

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "version": self.version,
            "kind": self.kind,
            "description": self.description,
            "parameters": self.parameters,
            "golden_tests_count": len(self.golden_tests),
            "file_path": self.file_path,
        }


class PromptRegistry:
    def __init__(self, prompts_dir: Optional[str] = None):
        if not prompts_dir:
            # Workspace root is 3 levels up from ai_service/app/services/
            root = Path(__file__).resolve().parent.parent.parent.parent
            prompts_dir = str(root / "prompts")
        self.prompts_dir = prompts_dir
        self._prompts: Dict[str, Dict[str, PromptTemplate]] = {}
        self.load_all()

    def load_all(self):
        self._prompts.clear()
        p_dir = Path(self.prompts_dir)
        if not p_dir.exists():
            return

        for f in p_dir.glob("*.md"):
            try:
                self._load_file(f)
            except Exception as e:
                # Log error and continue
                print(f"[PromptRegistry] Error loading {f}: {e}")

    def _load_file(self, path: Path):
        content = path.read_text(encoding="utf-8")
        # Check for front-matter --- ... ---
        match = re.match(r"^---\s*\n(.*?)\n---\s*\n(.*)$", content, re.DOTALL)
        if not match:
            # Legacy file without frontmatter - synthesize
            p_id = path.stem
            template = content
            prompt = PromptTemplate(
                prompt_id=p_id,
                version="1.0.0",
                kind="generic",
                description=f"Legacy prompt {p_id}",
                parameters=[],
                golden_tests=[],
                template=template,
                file_path=str(path),
            )
        else:
            front = yaml.safe_load(match.group(1)) or {}
            template = match.group(2).strip()
            p_id = front.get("id", path.stem)
            version = str(front.get("version", "1.0.0"))
            kind = front.get("kind", "generic")
            desc = front.get("description", "")
            params = front.get("parameters", [])
            golden = front.get("golden_tests", [])

            prompt = PromptTemplate(
                prompt_id=p_id,
                version=version,
                kind=kind,
                description=desc,
                parameters=params,
                golden_tests=golden,
                template=template,
                file_path=str(path),
            )

        if prompt.id not in self._prompts:
            self._prompts[prompt.id] = {}
        self._prompts[prompt.id][prompt.version] = prompt

    def get(self, prompt_id: str, version: Optional[str] = None) -> Optional[PromptTemplate]:
        if prompt_id not in self._prompts:
            return None
        versions = self._prompts[prompt_id]
        if version and version in versions:
            return versions[version]
        # Return latest version
        sorted_versions = sorted(versions.keys(), reverse=True)
        return versions[sorted_versions[0]] if sorted_versions else None

    def render(self, prompt_id: str, version: Optional[str] = None, **kwargs) -> str:
        prompt = self.get(prompt_id, version)
        if not prompt:
            raise KeyError(f"Prompt '{prompt_id}' not found in registry.")
        return prompt.render(**kwargs)

    def list_prompts(self) -> List[Dict[str, Any]]:
        res = []
        for p_id in sorted(self._prompts.keys()):
            latest = self.get(p_id)
            if latest:
                res.append(latest.to_dict())
        return res


prompt_registry = PromptRegistry()
