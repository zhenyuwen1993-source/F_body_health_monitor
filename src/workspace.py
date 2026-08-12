"""Per-user data directories for multi-tenant local health monitor."""

from __future__ import annotations

import shutil
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path

from src.auth import validate_username
from src.config import DATA_DIR

USERS_ROOT = DATA_DIR / "users"
LEGACY_MARK = DATA_DIR / ".legacy_migrated"


@dataclass(frozen=True)
class Workspace:
    username: str

    @property
    def root(self) -> Path:
        return USERS_ROOT / self.username

    @property
    def db_path(self) -> Path:
        return self.root / "health.db"

    @property
    def export_path(self) -> Path:
        return self.root / "export.xml"

    @property
    def reports_dir(self) -> Path:
        return self.root / "reports"

    @property
    def profile_path(self) -> Path:
        return self.root / "profile.json"

    @property
    def uploads_dir(self) -> Path:
        return self.root / "uploads"

    def ensure(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        self.reports_dir.mkdir(parents=True, exist_ok=True)
        self.uploads_dir.mkdir(parents=True, exist_ok=True)


def workspace_for(username: str) -> Workspace:
    name = validate_username(username)
    ws = Workspace(name)
    ws.ensure()
    return ws


def migrate_legacy_if_needed(target_user: str = "admin") -> bool:
    """Move legacy data/* into users/<target_user>/ once.

    Returns True if a migration ran.
    """
    if LEGACY_MARK.exists():
        return False
    legacy_db = DATA_DIR / "health.db"
    target = workspace_for(target_user)
    if not legacy_db.exists():
        LEGACY_MARK.write_text("no-legacy\n", encoding="utf-8")
        return False
    if target.db_path.exists():
        LEGACY_MARK.write_text(f"skipped-target-exists:{target_user}\n", encoding="utf-8")
        return False

    target.ensure()
    shutil.move(str(legacy_db), str(target.db_path))
    for name in ("export.xml", "profile.json"):
        src = DATA_DIR / name
        if src.exists() and not (target.root / name).exists():
            shutil.move(str(src), str(target.root / name))
    legacy_reports = DATA_DIR / "reports"
    if legacy_reports.exists() and legacy_reports.is_dir():
        for md in legacy_reports.glob("*.md"):
            dest = target.reports_dir / md.name
            if not dest.exists():
                shutil.move(str(md), str(dest))
    LEGACY_MARK.write_text(f"migrated-to:{target_user}\n", encoding="utf-8")
    return True


def extract_health_zip(zip_source: Path | bytes, workspace: Workspace) -> Path:
    """Extract Apple Health export zip; copy export.xml into workspace."""
    workspace.ensure()
    with tempfile.TemporaryDirectory(prefix="health_zip_") as tmp:
        tmp_path = Path(tmp)
        zip_path = tmp_path / "upload.zip"
        if isinstance(zip_source, bytes):
            zip_path.write_bytes(zip_source)
        else:
            shutil.copy2(zip_source, zip_path)

        extract_dir = tmp_path / "out"
        extract_dir.mkdir()
        with zipfile.ZipFile(zip_path, "r") as zf:
            for info in zf.infolist():
                name = info.filename
                if name.startswith("/") or ".." in Path(name).parts:
                    raise ValueError(f"不安全的 zip 路径: {name}")
            zf.extractall(extract_dir)

        # Don't rely on the file name: Chinese iPhones export the main file as
        # 「导出.xml」 (in a 「导出/」 folder), English ones as export.xml, and zip
        # entry names may even be mojibake. The main Apple Health export is always
        # the largest .xml in the archive — the clinical CDA file (导出_cda.xml /
        # export_cda.xml) is much smaller, so pick the largest non-CDA xml.
        xmls = list(extract_dir.rglob("*.xml"))
        if not xmls:
            raise ValueError("压缩包内未找到任何 xml（请用 iPhone 健康 App「导出所有健康数据」得到的 zip）")
        non_cda = [p for p in xmls if "cda" not in p.name.lower()]
        src = max(non_cda or xmls, key=lambda p: p.stat().st_size)
        shutil.copy2(src, workspace.export_path)

        try:
            stamp = workspace.uploads_dir / "last_upload.zip"
            shutil.copy2(zip_path, stamp)
        except OSError:
            pass

    return workspace.export_path
