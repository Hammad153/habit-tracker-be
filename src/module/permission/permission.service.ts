import { Injectable } from '@nestjs/common';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { UpdatePermissionDto } from './dto/update-permission.dto';

@Injectable()
export class PermissionService {
  create(createPermissionDto: CreatePermissionDto) {
    return createPermissionDto;
  }

  findAll() {
    return `This action returns all permission`;
  }

  findOne(id: string) {
    return `This action returns a #${id} permission`;
  }

  update(id: string, updatePermissionDto: UpdatePermissionDto) {
    return updatePermissionDto;
  }

  remove(id: string) {
    return `This action removes a #${id} permission`;
  }
}
