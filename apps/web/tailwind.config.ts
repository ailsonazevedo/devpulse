import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        github: "#6e5494",
        gitlab: "#fc6d26",
      },
    },
  },
  plugins: [],
} satisfies Config;
