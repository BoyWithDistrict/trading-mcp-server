import { UserDocument } from '../../models/user.model';

declare global {
  namespace Express {
    interface Request {
      user?: UserDocument | any; // Замените any на более конкретный тип пользователя
    }
  }
}
