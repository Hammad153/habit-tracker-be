declare module 'ejs' {
  interface RenderFileCallback<T> {
    (err: Error | null, rendered: T): void;
  }
  const ejs: {
    render(template: string, data?: object): string;
    renderFile(
      path: string,
      data: object,
      callback: RenderFileCallback<string>,
    ): void;
  };
  export default ejs;
}
