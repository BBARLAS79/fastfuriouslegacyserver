#!/usr/bin/env python3
import io
import json
import os
from pathlib import Path

import dnfile
from dncil.cil.body import CilMethodBody
from dncil.cil.body.reader import CilMethodBodyReaderBase


ROOT = Path("/Users/berkeipekci/Documents/New project/client_server_rebuild")
FIRSTPASS_DLL = Path("/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp-firstpass.dll")
OUTPUT_DIR = ROOT / "src" / "inferred030" / "generated"
MODULES_DIR = OUTPUT_DIR / "modules"


class PEMethodBodyReader(CilMethodBodyReaderBase):
    def __init__(self, pe, rva):
        self._stream = io.BytesIO(pe.get_data(rva, 0x6000))
        self._base_rva = rva

    def read(self, n):
        return self._stream.read(n)

    def tell(self):
        return self._base_rva + self._stream.tell()

    def seek(self, rva):
        self._stream.seek(rva - self._base_rva)
        return self.tell()


def full_name(type_row):
    return (str(type_row.TypeNamespace or "") + "." + str(type_row.TypeName or "")).strip(".")


def load_assembly(path):
    pe = dnfile.dnPE(str(path))
    method_rows = pe.net.mdtables.MethodDef.rows
    type_rows = pe.net.mdtables.TypeDef.rows
    type_map = {full_name(row): row for row in type_rows}
    return pe, method_rows, type_rows, type_map


PE, METHOD_ROWS, TYPE_ROWS, TYPE_MAP = load_assembly(FIRSTPASS_DLL)


def iter_type_methods(type_name):
    type_row = TYPE_MAP[type_name]
    for method in type_row.MethodList:
        if hasattr(method, "Name"):
            yield method
            continue
        row_index = getattr(method, "row_index", None)
        if row_index is not None and row_index - 1 < len(METHOD_ROWS):
            yield METHOD_ROWS[row_index - 1]
            continue
        if isinstance(method, int) and method - 1 < len(METHOD_ROWS):
            yield METHOD_ROWS[method - 1]


def safe_disasm(method_row):
    try:
        body = CilMethodBody(PEMethodBodyReader(PE, method_row.Rva))
        return list(body.instructions)
    except Exception:
        return []


def operand_name(insn):
    op = insn.operand
    if op is None:
        return None
    if hasattr(op, "Name"):
        return str(op.Name)
    token = getattr(op, "value", None)
    if token is None:
        return str(op)
    table = (token >> 24) & 0xFF
    index = (token & 0x00FFFFFF) - 1
    try:
        if table == 0x06 and index >= 0:
            return str(PE.net.mdtables.MethodDef.rows[index].Name)
        if table == 0x0A and index >= 0:
            return str(PE.net.mdtables.MemberRef.rows[index].Name)
    except Exception:
        pass
    return str(op)


def operand_user_string(insn):
    op = insn.operand
    token = getattr(op, "value", None)
    if token is None or (token >> 24) != 0x70:
        return None
    user_string = PE.net.user_strings.get(token & 0x00FFFFFF)
    if user_string is None:
        return None
    return str(user_string.value)


def find_recent_ldstr(insns, index, window=8):
    for i in range(index - 1, max(-1, index - window), -1):
        value = operand_user_string(insns[i])
        if value is None:
            continue
        if value.startswith("/"):
            continue
        return value
    return None


def infer_envelope(callback_infos):
    accessors = set()
    for callback_info in callback_infos:
        accessors.update(callback_info["response_accessors"])

    if "arrayList" in accessors:
        return "success -> response.arrayList"
    if "hashtable" in accessors:
        return "success -> response.hashtable"
    if "result" in accessors:
        return "success -> response.result"
    if "sucessful" in accessors:
        return "success -> no explicit payload"
    return "UNKNOWN"


def infer_failure_contract(callback_infos):
    accessors = set()
    for callback_info in callback_infos:
        accessors.update(callback_info["response_accessors"])

    if "localizedError" in accessors:
        return "failure -> response.localizedError"
    if "error" in accessors:
        return "failure -> response.error"
    return "UNKNOWN"


def describe_status(known_fields):
    return "PARTIAL" if known_fields else "UNKNOWN"


def extract_common_request_keys(api_type):
    common_keys = []
    try:
        add_data_method = next(method for method in iter_type_methods(api_type) if str(method.Name) == "AddData")
    except StopIteration:
        return common_keys

    insns = safe_disasm(add_data_method)
    for index, insn in enumerate(insns):
        if operand_name(insn) != "AddData":
            continue
        recent = find_recent_ldstr(insns, index)
        if recent and recent not in common_keys:
            common_keys.append(recent)
    return common_keys


def find_callback_methods(callback_names, api_type):
    found = []
    for callback_name in callback_names:
        for type_name in TYPE_MAP:
            if not (type_name.startswith("<") or type_name == api_type):
                continue
            for method_row in iter_type_methods(type_name):
                if str(method_row.Name) != callback_name:
                    continue
                found.append((type_name, method_row))
                break
    return found


def extract_callback_info(type_name, method_row):
    insns = safe_disasm(method_row)
    accessors = []
    fields = []
    for insn in insns:
        name = operand_name(insn)
        value = operand_user_string(insn)
        if name and name.startswith("get_"):
            accessors.append(name[4:])
        if value is not None and not value.startswith("/"):
            fields.append(value)
    return {
        "client_type": type_name,
        "client_method": str(method_row.Name),
        "response_accessors": sorted(set(accessors)),
        "literal_fields": sorted(set(fields))
    }


MANUAL_OVERRIDES = {
    "LoginAPI": {
        "Init": {
            "known_response_fields": {
                "result": "UNKNOWN"
            },
            "notes": [
                "Client only checks response.sucessful and forwards response.result to LoginManager._PostInit.",
                "No explicit inner fields are recovered from 0.3.0 client code."
            ],
            "additional_sources": [
                {
                    "file": str(FIRSTPASS_DLL),
                    "function": "EB.Sparx.LoginManager::Init"
                },
                {
                    "file": str(FIRSTPASS_DLL),
                    "function": "<Init>c__AnonStorey119::<>m__101"
                }
            ]
        },
        "Enumerate": {
            "known_request_keys": ["auth"],
            "known_response_fields": {
                "arrayList[]": {
                    "user": {
                        "uid": "required",
                        "name": "optional",
                        "email": "optional",
                        "gcid": "optional",
                        "fbid": "optional",
                        "cohort": "optional",
                        "revenue": "optional",
                        "time_revenue": "optional",
                        "time_last": "optional",
                        "level": "optional",
                        "naid": "optional"
                    },
                    "auth": {
                        "<authenticatorName>": {
                            "id": "required",
                            "data": "optional object"
                        }
                    }
                }
            },
            "notes": [
                "LoginAPI callback returns response.arrayList.",
                "Each account entry is parsed by EB.Sparx.Account::.ctor.",
                "account.user must be present; UserManager.GetUser searches for uid.",
                "account.auth must be a dictionary keyed by authenticator name."
            ],
            "additional_sources": [
                {
                    "file": str(FIRSTPASS_DLL),
                    "function": "EB.Sparx.Account::.ctor"
                },
                {
                    "file": str(FIRSTPASS_DLL),
                    "function": "EB.Sparx.UserManager::GetUser"
                },
                {
                    "file": str(FIRSTPASS_DLL),
                    "function": "EB.Sparx.User::Update"
                },
                {
                    "file": str(FIRSTPASS_DLL),
                    "function": "EB.Sparx.AuthData::.ctor"
                }
            ]
        },
        "PreLogin": {
            "known_request_keys": ["sha1"],
            "known_response_fields": {
                "result.salt": "required string",
                "result.url": "optional string; if present, client treats it as update-required"
            },
            "notes": [
                "Client computes chal locally after receiving salt.",
                "Server does not need to return chal."
            ],
            "additional_sources": [
                {
                    "file": str(FIRSTPASS_DLL),
                    "function": "EB.Sparx.LoginManager::_PreLogin"
                },
                {
                    "file": str(FIRSTPASS_DLL),
                    "function": "<_PreLogin>c__AnonStorey11C::<>m__10B"
                },
                {
                    "file": str(FIRSTPASS_DLL),
                    "function": "<_PreLogin>c__AnonStorey11D::<>m__10C"
                }
            ]
        },
        "Login": {
            "known_request_keys": ["authenticator", "credentials", "UNKNOWN(extra login payload)"],
            "known_response_fields": {
                "hashtable.stoken": "required string",
                "hashtable.user": {
                    "uid": "required",
                    "name": "optional",
                    "email": "optional",
                    "gcid": "optional",
                    "fbid": "optional",
                    "cohort": "optional",
                    "revenue": "optional",
                    "time_revenue": "optional",
                    "time_last": "optional",
                    "level": "optional",
                    "naid": "optional"
                },
                "hashtable.auth_data": {
                    "id": "required",
                    "data": "optional object"
                },
                "hashtable.server_tag": "optional string",
                "hashtable.install": "optional bool"
            },
            "notes": [
                "Client copies stoken into endpoint auth data immediately.",
                "user is resolved through UserManager.GetUser and therefore must contain uid.",
                "auth_data shape is authenticator-specific; only id/data are recoverable at base class level."
            ],
            "additional_sources": [
                {
                    "file": str(FIRSTPASS_DLL),
                    "function": "<Login>c__AnonStorey8E::<>m__59"
                },
                {
                    "file": str(FIRSTPASS_DLL),
                    "function": "<_Login>c__AnonStorey11A::<>m__10A"
                },
                {
                    "file": str(FIRSTPASS_DLL),
                    "function": "EB.Sparx.UserManager::GetUser"
                },
                {
                    "file": str(FIRSTPASS_DLL),
                    "function": "EB.Sparx.User::Update"
                },
                {
                    "file": str(FIRSTPASS_DLL),
                    "function": "EB.Sparx.AuthData::.ctor"
                },
                {
                    "file": str(FIRSTPASS_DLL),
                    "function": "KabamAuthData::get_Name"
                },
                {
                    "file": str(FIRSTPASS_DLL),
                    "function": "KabamAuthData::get_Email"
                }
            ]
        },
        "LoginData": {
            "known_request_keys": ["apiversions", "nid", "ncat", "ncta"],
            "known_response_fields": {
                "hashtable": "UNKNOWN"
            },
            "notes": [
                "The request includes manager api version map and optionally local notification fields.",
                "The response is forwarded as a hashtable; inner shape is not recoverable from LoginAPI alone."
            ]
        }
    },
    "DataAPI": {
        "Load": {
            "known_response_fields": {
                "hashtable": "UNKNOWN"
            },
            "notes": [
                "Client expects a hashtable on success. Inner save schema is UNKNOWN at the API layer and must be inferred from higher-level managers."
            ]
        },
        "Save": {
            "known_request_keys": ["data"],
            "known_response_fields": {},
            "notes": [
                "On success the callback only receives null error. No success payload is explicitly read."
            ]
        }
    },
    "TutorialAPI": {
        "GetLoginData": {
            "known_request_keys": ["api"],
            "known_response_fields": {
                "hashtable": "UNKNOWN"
            }
        },
        "StartTutorial": {
            "known_request_keys": ["api", "tid"],
            "known_response_fields": {
                "hashtable": "UNKNOWN"
            }
        },
        "EarlyStartBranch": {
            "known_request_keys": ["api", "tid", "bid"],
            "known_response_fields": {
                "hashtable": "UNKNOWN"
            }
        },
        "StartBranch": {
            "known_request_keys": ["api", "tid", "bid"],
            "known_response_fields": {
                "hashtable": "UNKNOWN"
            }
        }
    },
    "MatchAPI": {
        "ActivateMatch": {
            "known_request_keys": ["api", "type", "UNKNOWN(dynamic extra payload from caller)"],
            "known_response_fields": {
                "hashtable": "UNKNOWN"
            }
        }
    }
}


def build_endpoint_contract(api_type, method_row):
    method_name = str(method_row.Name)
    insns = safe_disasm(method_row)
    if not insns:
        return None

    paths = []
    callback_names = []
    request_keys = []
    verb = "UNKNOWN"

    for index, insn in enumerate(insns):
        string_value = operand_user_string(insn)
        if string_value and string_value.startswith("/"):
            paths.append(string_value)

        name = operand_name(insn)
        if verb == "UNKNOWN" and name in ("Get", "Post"):
            verb = name.upper()

        if name == "AddData":
            recent = find_recent_ldstr(insns, index)
            if recent and recent not in request_keys and not recent.startswith("/"):
                request_keys.append(recent)

        if str(insn.opcode) == "ldftn" and name:
            callback_names.append(name)

    if not paths:
        return None

    callback_infos = [extract_callback_info(type_name, method_row) for type_name, method_row in find_callback_methods(callback_names, api_type)]
    common_request_keys = extract_common_request_keys(api_type)
    merged_request_keys = []
    for key in common_request_keys + request_keys:
        if key not in merged_request_keys:
            merged_request_keys.append(key)

    contract = {
        "client_method": method_name,
        "verb": verb,
        "path": paths[0],
        "request_keys": merged_request_keys,
        "response_contract": {
            "success_envelope": infer_envelope(callback_infos),
            "failure_envelope": infer_failure_contract(callback_infos),
            "known_fields": {}
        },
        "status": "UNKNOWN",
        "sources": {
            "request": [
                {
                    "file": str(FIRSTPASS_DLL),
                    "function": f"{api_type}::{method_name}"
                }
            ],
            "response": [
                {
                    "file": str(FIRSTPASS_DLL),
                    "function": f"{info['client_type']}::{info['client_method']}"
                }
                for info in callback_infos
            ],
            "additional": []
        },
        "notes": []
    }

    override = MANUAL_OVERRIDES.get(api_type.split(".")[-1], {}).get(method_name)
    if override:
        if "known_request_keys" in override:
            contract["request_keys"] = override["known_request_keys"]
        if "known_response_fields" in override:
            contract["response_contract"]["known_fields"] = override["known_response_fields"]
        if "notes" in override:
            contract["notes"].extend(override["notes"])
        if "additional_sources" in override:
            contract["sources"]["additional"].extend(override["additional_sources"])

    contract["status"] = describe_status(contract["response_contract"]["known_fields"])
    return contract


def build_contract():
    modules = {}
    api_types = [name for name in sorted(TYPE_MAP) if name.startswith("EB.Sparx.") and name.endswith("API")]
    for api_type in api_types:
        simple_name = api_type.split(".")[-1]
        endpoints = []
        for method_row in iter_type_methods(api_type):
            endpoint = build_endpoint_contract(api_type, method_row)
            if endpoint:
                endpoints.append(endpoint)
        if not endpoints:
            continue
        modules[simple_name] = {
            "client_type": api_type,
            "source_file": str(FIRSTPASS_DLL),
            "common_request_keys": extract_common_request_keys(api_type),
            "endpoints": endpoints
        }

    return {
        "client": {
            "game": "FF7",
            "version_name": "0.3.0",
            "version_code": "72114",
            "source_assembly": str(FIRSTPASS_DLL)
        },
        "modules": modules,
        "unknowns": [
            {
                "module": "WebBridge",
                "status": "UNKNOWN",
                "why": "client_extract/js/common/base/gameinterface.js routes webview data through native GetServerData/GetArticleData bridge; HTTP endpoint mapping is not recoverable from JS alone.",
                "sources": [
                    {
                        "file": "/Users/berkeipekci/Documents/New project/client_extract/js/common/base/gameinterface.js",
                        "function": "callServerAPI"
                    },
                    {
                        "file": "/Users/berkeipekci/Documents/New project/client_extract/js/common/base/gameinterface.js",
                        "function": "getServerData"
                    },
                    {
                        "file": "/Users/berkeipekci/Documents/New project/client_extract/js/common/base/gameinterface.js",
                        "function": "getServerArticles"
                    }
                ]
            }
        ]
    }


def to_js(value, indent=0):
    spacing = "  " * indent
    next_spacing = "  " * (indent + 1)

    if isinstance(value, dict):
        if not value:
            return "{}"
        parts = []
        for key, inner in value.items():
            safe_key = key if key.isidentifier() else json.dumps(key)
            parts.append(f"{next_spacing}{safe_key}: {to_js(inner, indent + 1)}")
        return "{\n" + ",\n".join(parts) + "\n" + spacing + "}"

    if isinstance(value, list):
        if not value:
            return "[]"
        parts = [f"{next_spacing}{to_js(inner, indent + 1)}" for inner in value]
        return "[\n" + ",\n".join(parts) + "\n" + spacing + "]"

    return json.dumps(value, ensure_ascii=False)


MODULE_TEMPLATE = """const {{ createUnknownStub }} = require('../../stubRuntime');\n\nconst moduleContract = {contract};\n\nmoduleContract.handlers = Object.fromEntries(\n  moduleContract.endpoints.map((endpoint) => [\n    `${{endpoint.verb}} ${{endpoint.path}}`,\n    createUnknownStub(moduleContract.client_type, endpoint)\n  ])\n);\n\nmodule.exports = moduleContract;\n"""


INDEX_TEMPLATE = """module.exports = {{\n{exports}\n}};\n"""


README_CONTENT = """# FF7 0.3.0 Inferred Backend\n\nThis directory is generated strictly from the FF7 0.3.0 client implementation.\n\nRules used for generation:\n- No endpoint is added unless it is explicitly referenced by the client.\n- No field is marked KNOWN unless some client method reads it.\n- Anything not recoverable from the client is left as `UNKNOWN` and isolated behind a stub.\n\nGenerated artifacts:\n- `generated/contract.json`: machine-readable client contract.\n- `generated/modules/*.js`: module-by-module backend skeletons with source citations.\n- `modules.js`: convenience loader for all generated modules.\n\nTo regenerate after updating the client assembly:\n```bash\ncd '/Users/berkeipekci/Documents/New project/client_server_rebuild'\npython3 tools/generate_ff7_030_contract.py\n```\n"""


def write_outputs(contract):
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    MODULES_DIR.mkdir(parents=True, exist_ok=True)

    (OUTPUT_DIR / "contract.json").write_text(json.dumps(contract, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    index_lines = []
    for module_name, module_contract in sorted(contract["modules"].items()):
        module_path = MODULES_DIR / f"{module_name}.js"
        module_path.write_text(
            MODULE_TEMPLATE.format(contract=to_js(module_contract, 0)),
            encoding="utf-8"
        )
        index_lines.append(f"  {module_name}: require('./{module_name}')")

    (MODULES_DIR / "index.js").write_text(
        INDEX_TEMPLATE.format(exports=",\n".join(index_lines)),
        encoding="utf-8"
    )

    readme_path = ROOT / "src" / "inferred030" / "README.md"
    readme_path.parent.mkdir(parents=True, exist_ok=True)
    readme_path.write_text(README_CONTENT, encoding="utf-8")


def main():
    contract = build_contract()
    write_outputs(contract)
    print(f"Wrote {OUTPUT_DIR / 'contract.json'}")
    print(f"Wrote {MODULES_DIR}")


if __name__ == "__main__":
    main()
