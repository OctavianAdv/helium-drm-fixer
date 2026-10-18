// Files imported with `with { type: "file" }` resolve to a path string.
declare module "*.exe" {
  const path: string;
  export default path;
}
