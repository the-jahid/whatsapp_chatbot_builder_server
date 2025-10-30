import { applyDecorators, Type } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiBadRequestResponse,
  ApiExtraModels,
  getSchemaPath,
} from '@nestjs/swagger';
import { ApiEnvelopeBase } from '../dto/api-envelope.dto';

/** Build an ApiOkResponse with `{ code, status, message, data: <Model> }` */
export const ApiOkEnvelope = <TModel extends Type<unknown>>(model: TModel) =>
  applyDecorators(
    ApiExtraModels(ApiEnvelopeBase, model),
    ApiOkResponse({
      schema: {
        allOf: [
          { $ref: getSchemaPath(ApiEnvelopeBase) },
          {
            type: 'object',
            properties: {
              data: { $ref: getSchemaPath(model) },
            },
          },
        ],
      },
    }),
  );

/** Build an ApiCreatedResponse with `{ code, status, message, data: <Model> }` */
export const ApiCreatedEnvelope = <TModel extends Type<unknown>>(model: TModel) =>
  applyDecorators(
    ApiExtraModels(ApiEnvelopeBase, model),
    ApiCreatedResponse({
      schema: {
        allOf: [
          { $ref: getSchemaPath(ApiEnvelopeBase) },
          {
            type: 'object',
            properties: {
              data: { $ref: getSchemaPath(model) },
            },
          },
        ],
      },
    }),
  );

/** Simple 400 shape based on the same envelope (without data) */
export const ApiBadRequestEnvelope = () =>
  applyDecorators(
    ApiExtraModels(ApiEnvelopeBase),
    ApiBadRequestResponse({
      schema: {
        allOf: [{ $ref: getSchemaPath(ApiEnvelopeBase) }],
      },
    }),
  );
