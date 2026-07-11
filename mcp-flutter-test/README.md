# Flutter Test MCP Server

An MCP (Model Context Protocol) server for running and managing Flutter tests.

## Features

- **run_flutter_tests**: Run Flutter tests with optional filtering and verbose output
- **run_flutter_tests_coverage**: Run tests with code coverage report
- **get_flutter_test_info**: List all test files in a Flutter project

## Installation

```bash
npm install
npm run build
```

## Running the Server

**Development mode:**
```bash
npm run dev
```

**Production mode:**
```bash
npm run build
npm start
```

## Configuration in Claude

Add to your MCP settings to use this server with Claude:

```json
{
  "mcpServers": {
    "flutter-test": {
      "command": "node",
      "args": ["/absolute/path/to/dist/index.js"]
    }
  }
}
```

For VS Code + Copilot, add to your workspace settings:

```json
{
  "modelcontextprotocol.servers": {
    "flutter-test": {
      "command": "npm",
      "args": ["--prefix", "/path/to/mcp-flutter-test", "start"]
    }
  }
}
```

## Tools

### run_flutter_tests
Runs Flutter tests in a specified directory.

**Parameters:**
- `directory` (optional): Path to Flutter project (default: current directory)
- `filter` (optional): Filter tests by name pattern
- `verbose` (optional): Enable verbose output

**Example:**
```
Run tests in the mobile/ directory with name filter "widget"
```

### run_flutter_tests_coverage
Runs Flutter tests and generates a coverage report.

**Parameters:**
- `directory` (optional): Path to Flutter project

### get_flutter_test_info
Lists all test files in the Flutter project.

**Parameters:**
- `directory` (optional): Path to Flutter project

## Project Structure

```
mcp-flutter-test/
├── src/
│   └── index.ts          # Main MCP server implementation
├── dist/                 # Compiled JavaScript (generated)
├── package.json
├── tsconfig.json
└── README.md
```

## Troubleshooting

- **Flutter not found**: Ensure Flutter is installed and in your PATH
- **Permission denied**: Make sure the MCP server has execute permissions
- **Module not found**: Run `npm install` to install dependencies

## Development

This server uses the Anthropic MCP SDK. See [MCP documentation](https://modelcontextprotocol.io/) for more details.
