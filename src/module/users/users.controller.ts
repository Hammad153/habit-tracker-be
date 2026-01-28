import { MyLoggerService } from 'log/my-logger/my-logger.service';
import { SkipThrottle } from '@nestjs/throttler';
//import { DEFAULT_PAGE_SIZE } from 'src/constants';
import { Controller, Body } from '@nestjs/common';
//import { ApiCreateUserDocs, ApiGetAllUserDocs } from './user.swagger';
import { UsersService } from './users.service';
//import { Prisma } from '@prisma/client';
//import { RolesGuard } from 'src/guard/roles.guard';
//import { UseGuards } from '@nestjs/common';
//import { Roles } from 'src/core/decorators/roles.decorator';
//import { Role } from '@prisma/client';

@SkipThrottle()
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly logger: MyLoggerService,
  ) {}
  //
  //  @Post()
  //  @Roles(Role.OWNER, Role.ADMIN)
  //@ApiCreateUserDocs()
  //public async create(@Body() createUserDto: any) {
  //  return this.usersService.create(createUserDto);
  //}

  //@Get()
  //@Roles(Role.OWNER, Role.ADMIN, Role.MANAGER)
  //@ApiGetAllUserDocs()
  //  public async findAll(@Ip() ip: string, @Query() query: any) {
  //    this.logger.log(`Request for all users\t${ip}`);
  //
  //    const {
  //      page = 1,
  //      pageSize = DEFAULT_PAGE_SIZE,
  //      cursor,
  //      orderBy,
  //      role,
  //      nameSearch,
  //      roleSearch,
  //      companyId,
  //      ...rawFilters
  //    } = query;
  //
  //    const skip = (Number(page) - 1) * Number(pageSize);
  //    const take = Number(pageSize);
  //
  //    const { data, total } = await this.usersService.findAll(
  //      {
  //        skip,
  //        take,
  //        cursor: cursor ? { id: cursor } : undefined,
  //        where: { ...rawFilters },
  //        orderBy: orderBy ? { [orderBy]: 'asc' } : undefined,
  //        nameSearch,
  //        roleSearch,
  //      },
  //      role,
  //      companyId,
  //    );
  //
  //    return {
  //      data,
  //      total,
  //      page: Number(page),
  //      pageSize: Number(pageSize),
  //      totalPages: Math.ceil(total / Number(pageSize)),
  //    };
  //  }

  //@Throttle({ short: { ttl: 1000, limit: 1 } })
  //@Get(':id')
  //@ApiGetByIdUserDocs()
  //@Roles(Role.OWNER, Role.ADMIN, Role.MANAGER)
  //public async findOne(@Param('id') id: string) {
  //  return this.usersService.findOne(id);
  //}

  //  @Patch(':id')
  //  @ApiPatchUserDocs()
  //  //@Roles(Role.OWNER, Role.ADMIN)
  //  public async update(
  //    @Param('id') id: string,
  //    @Body() updateUserDto: Prisma.UserUpdateInput,
  //  ) {
  //    return this.usersService.update(id, updateUserDto);
  //  }
  //
  //  @Delete(':id')
  //  @ApiDeleteUserDocs()
  //  @Roles(Role.OWNER, Role.ADMIN)
  //  public async remove(@Param('id') id: string) {
  //    return this.usersService.remove(id);
  //  }
}
