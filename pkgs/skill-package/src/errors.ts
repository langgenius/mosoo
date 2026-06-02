export class SkillPackageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillPackageError";
  }
}
