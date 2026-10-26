# Data formats

Every binary file under `data/` uses one container:

```
bytes 0..3    magic "DBW1" (Drive Boston World, version 1)
bytes 4..7    uint32 little-endian: byte length of the JSON header
bytes 8..     JSON header (UTF-8), padded with spaces to a multiple of 4 bytes
then          payload typed arrays, each 4-byte aligned, in the order the header lists them
```

The header always carries `format`, `version`, `box` (name and lon/lat bounds),
`frame` (origin and projection), `created` (ISO date) and `sources` (manifest
hashes), plus a `arrays` list of `{ name, type, length, byteOffset }` entries
with offsets relative to the start of the payload. Readers check `format` and
`version` and refuse anything they do not know.

Files are committed gzipped (`.bin.gz`) and inflated in the browser with
`DecompressionStream`.

Individual formats are documented here as they are added by the pipeline.
