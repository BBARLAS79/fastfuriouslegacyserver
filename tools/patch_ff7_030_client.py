#!/usr/bin/env python3
from __future__ import annotations

import argparse
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path

import dnfile
import pefile


MANAGED_REL = "assets/bin/Data/Managed/Assembly-CSharp-firstpass.dll"


def find_typedef(pe: dnfile.dnPE, type_name: str):
    for index, row in enumerate(pe.net.mdtables.TypeDef.rows, start=1):
        if row.TypeName and row.TypeName.value == type_name:
            return index, row
    raise KeyError(f"type not found: {type_name}")


def find_methoddef(pe: dnfile.dnPE, type_name: str, method_name: str):
    _, td = find_typedef(pe, type_name)
    for idx in td.MethodList:
        row = idx.row
        if row.Name and row.Name.value == method_name:
            return idx.row_index, row
    raise KeyError(f"method not found: {type_name}::{method_name}")


def find_field_token(pe: dnfile.dnPE, type_name: str, field_name: str) -> int:
    _, td = find_typedef(pe, type_name)
    for idx in td.FieldList:
        row = idx.row
        if row.Name and row.Name.value == field_name:
            return 0x04000000 | idx.row_index
    raise KeyError(f"field not found: {type_name}::{field_name}")


def build_sha1_body(pe: dnfile.dnPE) -> bytes:
    ctor_token = 0x06000000 | find_methoddef(pe, "<SyncGenerateSHA1SignatureFromAPK>c__Iterator0", ".ctor")[0]
    jar_token = find_field_token(pe, "<SyncGenerateSHA1SignatureFromAPK>c__Iterator0", "jarPath")
    cb_token = find_field_token(pe, "<SyncGenerateSHA1SignatureFromAPK>c__Iterator0", "callback")
    jar_store_token = find_field_token(pe, "<SyncGenerateSHA1SignatureFromAPK>c__Iterator0", "<$>jarPath")
    cb_store_token = find_field_token(pe, "<SyncGenerateSHA1SignatureFromAPK>c__Iterator0", "<$>callback")
    return b"".join(
        [
            b"\x73" + ctor_token.to_bytes(4, "little"),  # newobj
            b"\x0A",  # stloc.0
            b"\x06",  # ldloc.0
            b"\x02",  # ldarg.0
            b"\x7D" + jar_token.to_bytes(4, "little"),  # stfld jarPath
            b"\x06",  # ldloc.0
            b"\x03",  # ldarg.1
            b"\x7D" + cb_token.to_bytes(4, "little"),  # stfld callback
            b"\x06",  # ldloc.0
            b"\x02",  # ldarg.0
            b"\x7D" + jar_store_token.to_bytes(4, "little"),  # stfld <$>jarPath
            b"\x06",  # ldloc.0
            b"\x03",  # ldarg.1
            b"\x7D" + cb_store_token.to_bytes(4, "little"),  # stfld <$>callback
            b"\x06",  # ldloc.0
            b"\x2A",  # ret
        ]
    )


def build_hmac_body(pe: dnfile.dnPE) -> bytes:
    ctor_token = 0x06000000 | find_methoddef(pe, "<SyncGenerateHMACSignatureFromAPK>c__Iterator1", ".ctor")[0]
    jar_token = find_field_token(pe, "<SyncGenerateHMACSignatureFromAPK>c__Iterator1", "jarPath")
    salt_token = find_field_token(pe, "<SyncGenerateHMACSignatureFromAPK>c__Iterator1", "salt")
    cb_token = find_field_token(pe, "<SyncGenerateHMACSignatureFromAPK>c__Iterator1", "callback")
    jar_store_token = find_field_token(pe, "<SyncGenerateHMACSignatureFromAPK>c__Iterator1", "<$>jarPath")
    salt_store_token = find_field_token(pe, "<SyncGenerateHMACSignatureFromAPK>c__Iterator1", "<$>salt")
    cb_store_token = find_field_token(pe, "<SyncGenerateHMACSignatureFromAPK>c__Iterator1", "<$>callback")
    return b"".join(
        [
            b"\x73" + ctor_token.to_bytes(4, "little"),  # newobj
            b"\x0A",  # stloc.0
            b"\x06",  # ldloc.0
            b"\x02",  # ldarg.0
            b"\x7D" + jar_token.to_bytes(4, "little"),  # stfld jarPath
            b"\x06",  # ldloc.0
            b"\x03",  # ldarg.1
            b"\x7D" + salt_token.to_bytes(4, "little"),  # stfld salt
            b"\x06",  # ldloc.0
            b"\x04",  # ldarg.2
            b"\x7D" + cb_token.to_bytes(4, "little"),  # stfld callback
            b"\x06",  # ldloc.0
            b"\x02",  # ldarg.0
            b"\x7D" + jar_store_token.to_bytes(4, "little"),  # stfld <$>jarPath
            b"\x06",  # ldloc.0
            b"\x03",  # ldarg.1
            b"\x7D" + salt_store_token.to_bytes(4, "little"),  # stfld <$>salt
            b"\x06",  # ldloc.0
            b"\x04",  # ldarg.2
            b"\x7D" + cb_store_token.to_bytes(4, "little"),  # stfld <$>callback
            b"\x06",  # ldloc.0
            b"\x2A",  # ret
        ]
    )


def get_next_rva(pe: dnfile.dnPE, current_rva: int) -> int:
    higher = sorted(row.Rva for row in pe.net.mdtables.MethodDef.rows if row.Rva and row.Rva > current_rva)
    if not higher:
        raise ValueError(f"no method after rva {hex(current_rva)}")
    return higher[0]


def patch_method_in_place(blob: bytearray, pe_meta: dnfile.dnPE, pe_img: pefile.PE, type_name: str, method_name: str, body: bytes):
    row_index, method_row = find_methoddef(pe_meta, type_name, method_name)
    _ = row_index
    rva = method_row.Rva
    next_rva = get_next_rva(pe_meta, rva)
    method_off = pe_img.get_offset_from_rva(rva)
    available = next_rva - rva
    if available < 12:
        raise ValueError(f"{type_name}::{method_name} has invalid slot size {available}")
    max_body = available - 12
    if len(body) > max_body:
        raise ValueError(
            f"{type_name}::{method_name} body too large ({len(body)} > {max_body})"
        )
    header = bytearray(blob[method_off : method_off + 12])
    header[4:8] = len(body).to_bytes(4, "little")
    blob[method_off : method_off + 12] = header
    body_start = method_off + 12
    body_end = method_off + available
    blob[body_start:body_end] = b"\x00" * (body_end - body_start)
    blob[body_start : body_start + len(body)] = body


def patch_dll(src: Path, dst: Path):
    pe_meta = dnfile.dnPE(str(src))
    pe_img = pefile.PE(str(src))
    blob = bytearray(src.read_bytes())

    patch_method_in_place(blob, pe_meta, pe_img, "APKSignature", "SyncGenerateSHA1SignatureFromAPK", build_sha1_body(pe_meta))
    patch_method_in_place(blob, pe_meta, pe_img, "APKSignature", "SyncGenerateHMACSignatureFromAPK", build_hmac_body(pe_meta))

    dst.write_bytes(blob)


def rebuild_apk(base_apk: Path, patched_dll: Path, output_apk: Path, keystore: Path, alias: str, storepass: str, keypass: str):
    with tempfile.TemporaryDirectory(prefix="ff7_030_patch_") as tmpdir:
        tmpdir = Path(tmpdir)
        unsigned_apk = tmpdir / "unsigned.apk"
        with zipfile.ZipFile(base_apk, "r") as zin, zipfile.ZipFile(unsigned_apk, "w", compression=zipfile.ZIP_DEFLATED) as zout:
            for item in zin.infolist():
                if item.filename.upper().startswith("META-INF/"):
                    continue
                data = patched_dll.read_bytes() if item.filename == MANAGED_REL else zin.read(item.filename)
                zout.writestr(item, data)
        shutil.copy2(unsigned_apk, output_apk)
        subprocess.run(
            [
                "jarsigner",
                "-keystore",
                str(keystore),
                "-storepass",
                storepass,
                "-keypass",
                keypass,
                str(output_apk),
                alias,
            ],
            check=True,
        )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-apk", type=Path, required=True)
    parser.add_argument("--managed-dll", type=Path, required=True)
    parser.add_argument("--patched-dll", type=Path, required=True)
    parser.add_argument("--output-apk", type=Path, required=True)
    parser.add_argument("--keystore", type=Path, required=True)
    parser.add_argument("--alias", default="androiddebugkey")
    parser.add_argument("--storepass", default="android")
    parser.add_argument("--keypass", default="android")
    args = parser.parse_args()

    patch_dll(args.managed_dll, args.patched_dll)
    rebuild_apk(
        base_apk=args.base_apk,
        patched_dll=args.patched_dll,
        output_apk=args.output_apk,
        keystore=args.keystore,
        alias=args.alias,
        storepass=args.storepass,
        keypass=args.keypass,
    )


if __name__ == "__main__":
    main()
