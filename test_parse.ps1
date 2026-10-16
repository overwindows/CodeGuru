$ErrorActionPreference = 'Stop'
function Install-NpmDeps {
  npm install react@^19.0.0 --legacy-peer-deps
}
Install-NpmDeps
