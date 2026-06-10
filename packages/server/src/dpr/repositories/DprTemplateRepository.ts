import { Kysely } from 'kysely';

export class DprTemplateRepository {
  constructor(private db: Kysely<any>) {}

  async create(originalBlob: Buffer | null, blankBlob: Buffer, geometryModel: any) {
    return await this.db.insertInto('dpr.template')
      .values({
        original_file_blob: originalBlob,
        blank_master_blob: blankBlob,
        geometry_model: JSON.stringify(geometryModel)
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async findById(id: string) {
    return await this.db.selectFrom('dpr.template')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
  }
}
