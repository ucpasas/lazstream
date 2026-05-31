/// <reference types="vite/client" />

// Vite ?worker import — returns a Worker constructor
declare module '*?worker' {
  const WorkerFactory: new () => Worker
  export default WorkerFactory
}

// Vite ?url import — returns the served URL as a string
declare module '*?url' {
  const src: string
  export default src
}

// Vite ?raw import — returns file contents as a string
declare module '*?raw' {
  const content: string
  export default content
}

// Explicit WGSL shader declarations (dts plugin needs concrete patterns)
declare module '*.wgsl' {
  const content: string
  export default content
}
declare module '*.wgsl?raw' {
  const content: string
  export default content
}