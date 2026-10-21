"""Conservative FTP copy for a prepared library; never removes saves or unknown files."""
from ftplib import FTP, error_perm
import hashlib
from pathlib import Path, PurePosixPath
import uuid


def read_remote(ftp, name, consume):
    ftp.retrbinary('RETR ' + name, consume, blocksize=262144)


def remote_digest(ftp, name):
    digest = hashlib.sha256()
    read_remote(ftp, name, digest.update)
    return digest.hexdigest()


class LibraryFTP(FTP):
    def cwd(self, dirname):
        self._sneslib_directory = None
        return super().cwd(dirname)


def ensure_dir(ftp, path):
    if isinstance(ftp, LibraryFTP) and getattr(ftp, '_sneslib_directory', None) == path:
        return
    ftp.cwd('/')
    for name in PurePosixPath(path).parts:
        if name == '/':
            continue
        if name in ('.', '..') or any(c in name for c in '\r\n'):
            raise ValueError('Pasta remota inválida.')
        try:
            ftp.cwd(name)
        except error_perm as error:
            if not str(error).startswith('550'):
                raise
            ftp.mkd(name); ftp.cwd(name)
    if isinstance(ftp, LibraryFTP):
        ftp._sneslib_directory = path


def upload_one(ftp, source, remote_dir, remote_name, expected):
    if Path(remote_name).name != remote_name or any(c in remote_name for c in '\r\n/\\'):
        raise ValueError('Nome remoto inválido.')
    ensure_dir(ftp, remote_dir)
    if remote_name in ftp.nlst():
        if remote_digest(ftp, remote_name) != expected:
            raise ValueError('Arquivo existente diferente: ' + remote_name + '. Preservado sem sobrescrever.')
        return 'identical'
    temp = '.sneslib-' + uuid.uuid4().hex + '.upload'
    try:
        with Path(source).open('rb') as data:
            ftp.storbinary('STOR ' + temp, data, blocksize=262144)
        if remote_digest(ftp, temp) != expected:
            raise ValueError('Integridade remota diferente: ' + remote_name)
        if remote_name in ftp.nlst():
            raise ValueError('Destino apareceu durante o envio; preservado: ' + remote_name)
        ftp.rename(temp, remote_name)
        return 'uploaded'
    except BaseException:
        try:
            ftp.delete(temp)
        except Exception:
            pass
        raise


def connect(host, port=2121):
    ftp = LibraryFTP()
    ftp.connect(host, port, timeout=45)
    ftp.login()
    return ftp
