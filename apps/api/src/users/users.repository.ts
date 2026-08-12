import { Injectable } from '@nestjs/common';
import { Role, type User } from '@payflow/database';

import { DatabaseService } from '../database/database.service';

@Injectable()
export class UsersRepository {
  constructor(private readonly database: DatabaseService) {}

  findByEmail(email: string): Promise<User | null> {
    return this.database.prisma.user.findUnique({ where: { email } });
  }

  findById(id: string): Promise<User | null> {
    return this.database.prisma.user.findUnique({ where: { id } });
  }

  createUser(email: string, passwordHash: string): Promise<User> {
    return this.database.prisma.user.create({
      data: {
        email,
        passwordHash,
        role: Role.USER,
      },
    });
  }
}
