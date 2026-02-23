import { User, Salon } from "@prisma/client";

declare global {
  namespace Express {
    interface Request {
      user?: User;
      salon?: Salon;
    }
  }
}
