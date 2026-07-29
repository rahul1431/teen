import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  TextContent,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { exec } from "child_process";
import { promisify } from "util";
import { resolve } from "path";

const execAsync = promisify(exec);

interface ToolResult {
  success: boolean;
  output?: string;
  error?: string;
}

const server = new Server({
  name: "flutter-test-mcp",
  version: "1.0.0",
});

// Define available tools
const tools: Tool[] = [
  {
    name: "run_flutter_tests",
    description: "Run Flutter tests in the specified directory",
    inputSchema: {
      type: "object" as const,
      properties: {
        directory: {
          type: "string",
          description:
            "Path to Flutter project directory (default: current directory)",
        },
        filter: {
          type: "string",
          description: "Filter tests by name pattern",
        },
        verbose: {
          type: "boolean",
          description: "Enable verbose output",
        },
      },
      required: [],
    },
  },
  {
    name: "run_flutter_tests_coverage",
    description: "Run Flutter tests with coverage report",
    inputSchema: {
      type: "object" as const,
      properties: {
        directory: {
          type: "string",
          description: "Path to Flutter project directory",
        },
      },
      required: [],
    },
  },
  {
    name: "get_flutter_test_info",
    description: "Get information about Flutter test files in a project",
    inputSchema: {
      type: "object" as const,
      properties: {
        directory: {
          type: "string",
          description: "Path to Flutter project directory",
        },
      },
      required: [],
    },
  },
];

// Tool implementations
async function runFlutterTests(
  directory: string = ".",
  filter?: string,
  verbose?: boolean
): Promise<ToolResult> {
  try {
    const projectDir = resolve(directory);
    let command = `cd "${projectDir}" && flutter test`;

    if (filter) {
      command += ` --name "${filter}"`;
    }

    if (verbose) {
      command += " -v";
    }

    const { stdout, stderr } = await execAsync(command, { maxBuffer: 10 * 1024 * 1024 });

    return {
      success: true,
      output: stdout || stderr,
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: errorMessage,
    };
  }
}

async function runFlutterTestsCoverage(
  directory: string = "."
): Promise<ToolResult> {
  try {
    const projectDir = resolve(directory);
    const command = `cd "${projectDir}" && flutter test --coverage`;

    const { stdout, stderr } = await execAsync(command, { maxBuffer: 10 * 1024 * 1024 });

    return {
      success: true,
      output: stdout || stderr,
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: errorMessage,
    };
  }
}

async function getFlutterTestInfo(directory: string = "."): Promise<ToolResult> {
  try {
    const projectDir = resolve(directory);
    const command = `cd "${projectDir}" && find test -name "*_test.dart" -type f 2>/dev/null | head -20`;

    const { stdout } = await execAsync(command);

    const testFiles = stdout
      .split("\n")
      .filter((f) => f.trim())
      .map((f) => f.trim());

    return {
      success: true,
      output: `Found ${testFiles.length} test files:\n${testFiles.join("\n")}`,
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: errorMessage,
    };
  }
}

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  let result: ToolResult;

  switch (name) {
    case "run_flutter_tests":
      result = await runFlutterTests(
        (args as any)?.directory,
        (args as any)?.filter,
        (args as any)?.verbose
      );
      break;

    case "run_flutter_tests_coverage":
      result = await runFlutterTestsCoverage((args as any)?.directory);
      break;

    case "get_flutter_test_info":
      result = await getFlutterTestInfo((args as any)?.directory);
      break;

    default:
      result = {
        success: false,
        error: `Unknown tool: ${name}`,
      };
  }

  const content: TextContent[] = [
    {
      type: "text",
      text: result.success
        ? result.output || "Command executed successfully"
        : `Error: ${result.error}`,
    },
  ];

  return {
    content,
    isError: !result.success,
  };
});

// Handle list tools request
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools,
  };
});

// Handle resource requests (optional but good for completeness)
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [],
  };
});

server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
  return {
    resourceTemplates: [],
  };
});

server.setRequestHandler(ReadResourceRequestSchema, async () => {
  throw new Error("Resources not supported by this MCP server");
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Flutter Test MCP Server running on stdio");
}

main().catch(console.error);
