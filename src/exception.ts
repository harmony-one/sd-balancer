import {
    Catch,
    ExceptionFilter,
    ArgumentsHost,
    HttpException,
} from '@nestjs/common';
import { EntityNotFoundError } from 'typeorm/error/EntityNotFoundError';
import { Response } from 'express';

/**
 * Custom exception filter to convert EntityNotFoundError from TypeOrm to NestJs responses
 * @see also @https://docs.nestjs.com/exception-filters
 */
@Catch(EntityNotFoundError, Error)
export class HttpExceptionFilter implements ExceptionFilter {
    public catch(exception: EntityNotFoundError, host: ArgumentsHost) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse<Response>();

        return response.status(500).json({
            errorCode: 500,
            message: exception.message,
        });
    }
}

