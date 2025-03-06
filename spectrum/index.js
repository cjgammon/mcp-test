import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getAllTokens } from "@adobe/spectrum-tokens";
import colorConvert from "color-convert"; // You may need to install this: npm install color-convert

// Create an MCP server
const server = new McpServer({
  name: "Spectrum",
  version: "1.0.0",
});

// Initialize server with tokens
async function initializeServer() {
  // Get all tokens from Spectrum library
  const tokens = await getAllTokens();

  console.log(tokens);

  // Function to check if a token has a specific color hue
  function tokenHasHue(token, hue, tolerance = 30) {
    // Only process color tokens
    if (!token || !token.sets) return false;

    // Check light set first (could be extended to check other sets)
    const lightSet = token.sets.light;
    if (!lightSet || !lightSet.value) return false;

    // Try to extract RGB from color value
    try {
      let rgb;
      if (lightSet.value.startsWith("#")) {
        // Handle hex values
        const hex = lightSet.value.substring(1);
        rgb = [
          parseInt(hex.substring(0, 2), 16),
          parseInt(hex.substring(2, 4), 16),
          parseInt(hex.substring(4, 6), 16),
        ];
      } else if (lightSet.value.startsWith("rgb")) {
        // Handle rgb/rgba values
        const matches = lightSet.value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
        if (matches) {
          rgb = [
            parseInt(matches[1]),
            parseInt(matches[2]),
            parseInt(matches[3]),
          ];
        }
      }

      if (rgb) {
        // Convert RGB to HSL to check hue
        const [h, s, l] = colorConvert.rgb.hsl(rgb);
        const hueDiff = Math.min(Math.abs(h - hue), 360 - Math.abs(h - hue));
        return hueDiff <= tolerance && s > 10; // Must have some saturation to have color
      }
    } catch (e) {
      // Just skip tokens we can't process
      return false;
    }

    return false;
  }

  // Register a tool to query tokens
  server.tool(
    "spectrum-tokens",
    {
      query: z.string().describe("Query type (e.g., 'hue', 'name')"),
      value: z.string().describe("Search value (e.g., 'blue', '240')"),
      limit: z
        .number()
        .optional()
        .describe("Maximum number of results to return"),
    },
    async ({ query, value, limit = 10 }) => {
      let matchedTokens = [];

      if (query === "hue") {
        // Convert color name to hue value
        let hue;
        try {
          if (isNaN(parseInt(value))) {
            // Convert color name to hue
            switch (value.toLowerCase()) {
              case "red":
                hue = 0;
                break;
              case "orange":
                hue = 30;
                break;
              case "yellow":
                hue = 60;
                break;
              case "green":
                hue = 120;
                break;
              case "cyan":
                hue = 180;
                break;
              case "blue":
                hue = 240;
                break;
              case "purple":
                hue = 270;
                break;
              case "magenta":
                hue = 300;
                break;
              default:
                hue = 0;
            }
          } else {
            hue = parseInt(value);
          }

          // Find tokens with matching hue
          for (const [tokenName, tokenValue] of Object.entries(tokens)) {
            if (tokenHasHue(tokenValue, hue)) {
              matchedTokens.push({
                name: `--spectrum-${tokenName}`,
                value: tokenValue.sets.light?.value || "unknown",
              });

              if (matchedTokens.length >= limit) break;
            }
          }
        } catch (e) {
          return {
            content: [
              {
                type: "text",
                text: `Error processing hue query: ${e.message}`,
              },
            ],
          };
        }
      } else if (query === "name") {
        // Find tokens by name pattern
        const searchPattern = value.toLowerCase();
        for (const [tokenName, tokenValue] of Object.entries(tokens)) {
          if (tokenName.toLowerCase().includes(searchPattern)) {
            matchedTokens.push({
              name: tokenName,
              value: tokenValue.sets?.light?.value || "unknown",
            });

            if (matchedTokens.length >= limit) break;
          }
        }
      }
      // Add this new query type to your existing server.tool function
      else if (query === "color") {
        // Handle color hash input (e.g., #FF5500)
        try {
          // Ensure the value is a valid hex color
          if (
            !value.startsWith("#") ||
            !(value.length === 4 || value.length === 7)
          ) {
            throw new Error(
              "Invalid color format. Please use #RGB or #RRGGBB format.",
            );
          }

          // Convert short hex (#RGB) to full hex (#RRGGBB) if needed
          const fullHex =
            value.length === 4
              ? `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`
              : value;

          // Convert input color to RGB
          const inputRGB = [
            parseInt(fullHex.substring(1, 3), 16),
            parseInt(fullHex.substring(3, 5), 16),
            parseInt(fullHex.substring(5, 7), 16),
          ];

          // Convert to HSL for better comparison
          const inputHSL = colorConvert.rgb.hsl(inputRGB);

          // Store tokens with their color distance
          const tokenDistances = [];

          for (const [tokenName, tokenValue] of Object.entries(tokens)) {
            // Only process color tokens
            if (
              !tokenValue ||
              !tokenValue.sets ||
              !tokenValue.sets.light ||
              !tokenValue.sets.light.value
            ) {
              continue;
            }

            const lightValue = tokenValue.sets.light.value;

            // Extract RGB from token color
            let tokenRGB;
            if (lightValue.startsWith("#")) {
              // Handle hex values
              const hex = lightValue.substring(1);
              tokenRGB = [
                parseInt(hex.substring(0, 2), 16),
                parseInt(hex.substring(2, 4), 16),
                parseInt(hex.substring(4, 6), 16),
              ];
            } else if (lightValue.startsWith("rgb")) {
              // Handle rgb/rgba values
              const matches = lightValue.match(
                /rgba?\((\d+),\s*(\d+),\s*(\d+)/i,
              );
              if (matches) {
                tokenRGB = [
                  parseInt(matches[1]),
                  parseInt(matches[2]),
                  parseInt(matches[3]),
                ];
              }
            }

            if (tokenRGB) {
              // Calculate color distance (Euclidean distance in RGB space)
              const distance = Math.sqrt(
                Math.pow(tokenRGB[0] - inputRGB[0], 2) +
                  Math.pow(tokenRGB[1] - inputRGB[1], 2) +
                  Math.pow(tokenRGB[2] - inputRGB[2], 2),
              );

              tokenDistances.push({
                name: `--spectrum-${tokenName}`,
                value: lightValue,
                distance: distance,
              });
            }
          }

          // Sort by closest color (smallest distance)
          tokenDistances.sort((a, b) => a.distance - b.distance);

          // Take the top matches
          matchedTokens = tokenDistances.slice(0, limit).map((item) => ({
            name: item.name,
            value: item.value,
            similarity: `${Math.round((1 - item.distance / 441.67) * 100)}%`, // 441.67 is max possible distance (sqrt of 255^2 * 3)
          }));
        } catch (e) {
          return {
            content: [
              {
                type: "text",
                text: `Error processing color query: ${e.message}`,
              },
            ],
          };
        }
      }

      // Format the results
      let resultText;
      if (matchedTokens.length > 0) {
        resultText = `Found ${matchedTokens.length} matching tokens:\n\n`;
        matchedTokens.forEach((token, i) => {
          /*
          resultText += `${i + 1}. ${token.name}: ${token.value}\n`;
          */
          if (query === "color") {
            resultText += `${i + 1}. ${token.name}: ${token.value} (Match: ${token.similarity})\n`;
          } else {
            resultText += `${i + 1}. ${token.name}: ${token.value}\n`;
          }
        });
      } else {
        resultText = `No tokens found matching ${query} = ${value}`;
      }

      return {
        content: [{ type: "text", text: resultText }],
      };
    },
  );

  // Start receiving messages on stdin and sending messages on stdout
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Initialize the server
initializeServer().catch((error) => {
  console.error("Failed to initialize MCP server:", error);
  process.exit(1);
});
