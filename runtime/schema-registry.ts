import { readFile } from "node:fs/promises";
import path from "node:path";
import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";

export class SchemaValidationError extends Error {
  constructor(readonly schemaName: string, readonly validationErrors: ErrorObject[]) {
    super(`Output failed ${schemaName} validation: ${validationErrors.map((error) => `${error.instancePath || "/"} ${error.message ?? error.keyword}`).join("; ")}`);
  }
}

export class SchemaRegistry {
  private readonly ajv = new Ajv2020({ allErrors: true, strict: true, formats: { "date-time": true } });
  private readonly validators = new Map<string, ValidateFunction>();

  constructor(readonly schemaDirectory: string) {}

  schemaPath(name: string): string {
    if (!/^[a-z-]+$/.test(name)) {
      throw new Error(`Invalid schema name: ${name}`);
    }
    return path.join(this.schemaDirectory, `${name}.schema.json`);
  }

  async validator(name: string): Promise<ValidateFunction> {
    const cached = this.validators.get(name);
    if (cached) return cached;
    const schema = JSON.parse(await readFile(this.schemaPath(name), "utf8")) as object;
    const validate = this.ajv.compile(schema);
    this.validators.set(name, validate);
    return validate;
  }

  async validate<T>(name: string, data: unknown): Promise<T> {
    const validate = await this.validator(name);
    if (!validate(data)) {
      throw new SchemaValidationError(name, validate.errors ?? []);
    }
    return data as T;
  }
}
