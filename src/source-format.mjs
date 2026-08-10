export const LIFTOSAUR_TERMINAL_LF_COUNT = 3;

export function normalizeLineEndings(source) {
  return source.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function canonicalizeLiftosaurSource(source) {
  return `${normalizeLineEndings(source).replace(/\n*$/, "")}\n\n\n`;
}

export function assertCanonicalLiftosaurSource(source, label = "Liftosaur source") {
  if (source.includes("\r")) {
    throw new Error(`${label} must use LF line endings`);
  }
  const terminal = source.match(/\n*$/)?.[0].length ?? 0;
  if (terminal !== LIFTOSAUR_TERMINAL_LF_COUNT) {
    throw new Error(
      `${label} must end with exactly ${LIFTOSAUR_TERMINAL_LF_COUNT} LF characters; found ${terminal}`
    );
  }
}
