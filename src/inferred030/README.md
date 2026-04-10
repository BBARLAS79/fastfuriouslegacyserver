# FF7 0.3.0 Inferred Backend

This directory is generated strictly from the FF7 0.3.0 client implementation.

Rules used for generation:
- No endpoint is added unless it is explicitly referenced by the client.
- No field is marked KNOWN unless some client method reads it.
- Anything not recoverable from the client is left as `UNKNOWN` and isolated behind a stub.

Generated artifacts:
- `generated/contract.json`: machine-readable client contract.
- `generated/modules/*.js`: module-by-module backend skeletons with source citations.
- `modules.js`: convenience loader for all generated modules.

To regenerate after updating the client assembly:
```bash
cd '/Users/berkeipekci/Documents/New project/client_server_rebuild'
python3 tools/generate_ff7_030_contract.py
```
