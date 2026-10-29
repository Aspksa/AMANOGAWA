import socket

import pytest

from server.__main__ import listen_socket
from server import launcher


def test_busy_port_is_replaced_by_reserved_free_port():
    with socket.create_server(("127.0.0.1", 0)) as occupied:
        port = occupied.getsockname()[1]
        with listen_socket("127.0.0.1", port) as selected:
            actual = selected.getsockname()[1]
            assert actual != port
            with pytest.raises(OSError):
                socket.create_server(("127.0.0.1", actual))


@pytest.mark.parametrize("host,port", [("0.0.0.0", 8000), ("127.0.0.1", -1), ("127.0.0.1", 65536)])
def test_invalid_bind_is_rejected(host, port):
    with pytest.raises(ValueError):
        listen_socket(host, port)


def test_source_changes_invalidate_installed_dependencies(monkeypatch, tmp_path):
    monkeypatch.setattr(launcher, "ROOT", tmp_path)
    (tmp_path / "requirements.txt").write_text("package\n")
    vendor = tmp_path / "vendor/RAG-Anything"
    vendor.mkdir(parents=True)
    source = vendor / "version.py"
    source.write_text("VERSION = '1'\n")
    before = launcher.fingerprint()
    source.write_text("VERSION = '2'\n")
    assert launcher.fingerprint() != before
    before = launcher.fingerprint()
    (tmp_path / "requirements-core.txt").write_text("fastapi\n")
    assert launcher.fingerprint() != before
