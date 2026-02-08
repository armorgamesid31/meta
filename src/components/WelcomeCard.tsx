import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./ui/card"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { Separator } from "./ui/separator"
import { Hand } from "lucide-react"
import { useState } from "react"

export function WelcomeCard() {
  const [name, setName] = useState("")

  return (
    <Card className="w-[350px] m-4">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Hand className="h-6 w-6 text-primary animate-pulse" />
          <CardTitle>Hoşgeldiniz</CardTitle>
        </div>
        <CardDescription>Modern UI altyapısı başarıyla kuruldu.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid w-full items-center gap-4">
          <div className="flex flex-col space-y-1.5">
            <label htmlFor="name" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
              İsim
            </label>
            <Input 
              id="name" 
              placeholder="Adınız" 
              value={name}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
            />
          </div>
        </div>
      </CardContent>
      <Separator className="my-4" />
      <CardFooter className="flex justify-between">
        <Button variant="outline">İptal</Button>
        <Button onClick={() => alert(`Merhaba ${name}!`)}>Başla</Button>
      </CardFooter>
    </Card>
  )
}
