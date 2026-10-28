// What the README's server rendering example uses of Next's
// `next/headers`, so its example type-checks without Next installed.
declare module "next/headers" {
  export function cookies(): Promise<{
    get(name: string): { name: string; value: string } | undefined;
  }>;
}
