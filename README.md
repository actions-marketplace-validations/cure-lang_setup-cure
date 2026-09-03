# Setup Cure GitHub Action

`setup-cure` sets up the [Cure programming language](https://github.com/cure-lang/cure-lang) environment in GitHub Actions workflows.

It resolves the requested Cure version (or fetches the latest release from GitHub), adds the `cure` executable to `PATH`, configures `CURE_HOME` and `CURE_LIB` environment variables, and caches installed artifacts for fast workflow runs.

## Usage

### Basic Example

```yaml
steps:
  - uses: actions/checkout@v4

  - name: Set up Erlang & Elixir
    uses: erlef/setup-beam@v1
    with:
      elixir-version: '1.18'
      otp-version: '27'

  - name: Set up Cure
    uses: cure-lang/setup-cure@v1
    with:
      cure-version: 'latest'

  - name: Verify Cure installation
    run: cure version
```

### Specific Version

```yaml
  - name: Set up Cure v0.34.2
    uses: cure-lang/setup-cure@v1
    with:
      cure-version: '0.34.2'
```

### Matrix Builds

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        cure-version: ['0.33.1', '0.34.0', 'latest']
    steps:
      - uses: actions/checkout@v4
      - uses: erlef/setup-beam@v1
        with:
          elixir-version: '1.18'
          otp-version: '27'
      - uses: cure-lang/setup-cure@v1
        with:
          cure-version: ${{ matrix.cure-version }}
      - run: cure test
```

## Inputs

| Input | Description | Default |
| --- | --- | --- |
| `cure-version` | Version of Cure to set up (`latest`, `0.34.2`, `v0.34.2`, etc.) | `latest` |
| `version` | Alias for `cure-version` | `''` |
| `github-token` | GitHub API token to avoid rate limits when resolving releases | `${{ github.token }}` |
| `cache` | Enable tool caching for installed Cure binaries and stdlib | `true` |

## Outputs

| Output | Description |
| --- | --- |
| `cure-version` | Resolved version string of the installed Cure language |
| `cure-path` | Directory path containing the `cure` executable |
| `cache-hit` | `true` if restored from runner tool cache, `false` otherwise |

## Environment Variables Set

This action automatically sets the following environment variables for subsequent workflow steps:

* `CURE_HOME`: Points to the installation directory containing Cure binaries and standard library files (`priv/std`, `priv/ebin`).
* `CURE_LIB`: Points to `CURE_HOME/priv/ebin` containing compiled stdlib BEAM modules.
* `CURE_VERSION`: The resolved version string (e.g. `0.34.2`).

## License

[MIT](LICENSE)
